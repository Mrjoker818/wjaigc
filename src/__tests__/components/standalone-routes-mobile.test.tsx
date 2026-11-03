// @vitest-environment node
import { readOwnedOneSecondVideo } from '../../../tests/helpers/owned-media-fixture';
// Real standalone components and browser dependencies. Owned .invalid HTTP only.
// Viewport/native mouse/key/wheel evidence is not physical Android or Coze acceptance.
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Locator, type Download } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Surface = 'create' | 'canvas-share' | 'recharge';
type Theme = 'gold' | 'mono';
interface Options { surface: Surface; variant?: string; boundary?: 'http' | 'ws' | 'post' }
interface FixtureWindow extends Window { routeUi: { mount(theme: Theme, options: Options): void; unmount(): void; disposed: boolean; qrSettled: number; qrRejected: number; setToken(value: string): void; setOrder(value: string): void } }
interface Session { origin: string; downloadServer?: Server; downloadRequests: number; downloadFinished: number; context: BrowserContext; page: Page; options: Options; faults: string[]; handlers: Set<Promise<void>>; pending: Set<Request>; counts: Map<string, number>; expectedAbort: Set<Request>; blockedWs: string[]; mounted: boolean; closing: boolean; gate: Promise<void>; release(): void }
const ORIGIN = 'https://standalone-routes-mobile.invalid';
const TOKEN = 'A'.repeat(43), MEDIA = 'csr_' + 'B'.repeat(43);
const LONG = 'SYNTHETIC_LONG_NOTE_'.repeat(15);
const MODEL_REPLY = { success: true, providers: [{ id: 'w-a', name: '合成供应商甲' }, { id: 'w-b', name: '合成供应商乙' }], models: [{ id: 'w-image', name: '同名图像', providerId: 'w-a' }, { id: 'w-image', name: '同名图像', providerId: 'w-b' }], taskModelCatalog: ['w-a', 'w-b'].map(providerId => ({ providerId, modelId: 'w-image', kind: 'image', allowedRatios: ['1:1', '16:9'], allowedSizes: ['1024x1024'], qualityOptions: ['standard'], maxOutputs: 4, supportsReferenceImages: true, maxReferenceImages: 2 })) };
const ENTRY = [
 "import React,{Suspense,useState} from 'react';",
 "import {createRoot} from 'react-dom/client';",
 "import {SimpleCreateApp} from '@/components/simple-create/simple-create-page';",
 "import {SharedCanvasClient} from '@/app/shared/canvas/[token]/shared-canvas-client';",
 "import RechargePage from '@/app/recharge/[orderId]/page';",
 "import {PathParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';",
 "import {Providers} from '@/app/simple-chat/providers';",
 "import QRCode from 'qrcode';",
 "const root=createRoot(document.getElementById('route-root'));const orderParams=Promise.resolve({orderId:'w-order'});",
 "function App({options}){const[activeOrderParams,setOrderParams]=useState(orderParams);ui.setOrder=id=>setOrderParams(Promise.resolve({orderId:id}));const[token,setToken]=useState('A'.repeat(43));ui.setToken=setToken;return options.surface==='create'?<SimpleCreateApp initialProjectId={options.variant==='missing'?'':'w-project'}/>:options.surface==='canvas-share'?<PathParamsContext.Provider value={{token}}><SharedCanvasClient/></PathParamsContext.Provider>:<Suspense fallback={<p>等待路由参数</p>}><RechargePage params={activeOrderParams}/></Suspense>;}",
 "function Launch({options}){const[active,setActive]=useState(false);return active?<App options={options}/>:<button onClick={()=>setActive(true)}>打开合成独立页面</button>;}",
 "const ui={disposed:false,qrSettled:0,qrRejected:0,setToken(){},setOrder(){},mount(theme,options){if(['ab-qr-failure','ab-qr-alipay-custom'].includes(options.variant)){const original=QRCode.toDataURL.bind(QRCode);QRCode.toDataURL=(...args)=>original(...args).then(value=>{ui.qrSettled++;return value;},error=>{ui.qrSettled++;ui.qrRejected++;throw error;});}localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');if(options.variant==='returned'||options.variant?.startsWith('ab-notify'))sessionStorage.setItem('recharge_pay_w-order','1');root.render(<Providers><Launch options={options}/></Providers>);},unmount(){if(!ui.disposed){ui.disposed=true;root.unmount();}}};Object.assign(window,{routeUi:ui});"
].join('\n');
let browser: Browser | undefined, bundle = '', runtimeBundle = '', css = '', png: Buffer, aaFilm: Buffer;
const live = new Set<Session>();
beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('W_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const runtime = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), define: { __dirname: '"/"' }, stdin: { contents: "import process from 'next/dist/compiled/process';globalThis.process=process;", resolveDir: process.cwd(), loader: 'js', sourcefile: 'standalone-next-browser-process.js' } });
  if (runtime.outputFiles.length !== 1) throw Error('W_NEXT_BROWSER_RUNTIME_REQUIRED');
  runtimeBundle = runtime.outputFiles[0].text;
  const built = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' }, stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'standalone-routes-mobile-entry.tsx' } });
  if (built.outputFiles.length !== 1) throw Error('W_MEMORY_BUNDLE_REQUIRED');
  bundle = built.outputFiles[0].text;
  const inputs = Object.keys(built.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(inputs.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(), loadStylesheet: async (id: string, base: string) => { const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id); return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') }; } });
  css = compiler.build(new Scanner({}).scanFiles(sources));
  const sharp = require('sharp') as typeof import('sharp').default;
  png = await sharp({ create: { width: 320, height: 240, channels: 4, background: '#d4af37' } }).png().toBuffer();
  aaFilm = await readOwnedOneSecondVideo();
  browser = await chromium.launch({ headless: true });
}, 30000);
async function frames(page: Page): Promise<void> { await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); }
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('W_DRAIN_TIMEOUT ' + label)), 4000); })]); } finally { if (timer) clearTimeout(timer); } }
function documentReply(empty = false): Record<string, unknown> { return { title: '合成只读画布', revisionLabel: '修订 1', createdAt: '2026-10-19T00:00:00.000Z', allowDownload: true, viewport: { offsetX: 0, offsetY: 0, zoom: 1 }, items: empty ? [] : [{ itemRef: MEDIA, entityType: 'canvas-image', assetKind: 'image', transform: { x: 20, y: 20, width: 160, height: 120, rotation: 0, zIndex: 1 }, display: { label: '合成海报', altText: '合成金色海报' }, mimeType: 'image/png', width: 320, height: 240, mediaPath: 'media/' + MEDIA, downloadPath: 'media/' + MEDIA + '/download' }] }; }

// AA continues the original matrix; these are synthetic HTTP fixtures, not cloud acceptance.
const AA_NEXT = 'N'.repeat(43), AA_SECOND = 'csr_' + 'C'.repeat(43);
function aaDocument(variant: string, next: boolean): Record<string, unknown> {
  const allowDownload = variant !== 'aa-download-denied';
  const video = variant === 'aa-video', ref = next ? AA_SECOND : MEDIA;
  const item = (itemRef: string, second: boolean): Record<string, unknown> => ({
    itemRef, entityType: video ? 'canvas-video' : 'canvas-image', assetKind: video ? 'video' : 'image',
    transform: { x: second ? 190 : 20, y: 20, width: video ? 240 : 160, height: video ? 135 : 120, rotation: 0, zIndex: second ? 2 : 1 },
    display: { label: video ? '合成视频' : second ? '合成副图' : '合成海报', altText: video ? '合成视频' : second ? '合成副图' : '合成金色海报' },
    mimeType: video ? 'video/mp4' : 'image/png', width: video ? 160 : 320, height: video ? 90 : 240,
    mediaPath: 'media/' + itemRef, ...(allowDownload ? { downloadPath: 'media/' + itemRef + '/download' } : {}),
  });
  return { ...documentReply(), title: next ? '分享乙' : '分享甲', allowDownload,
    items: variant === 'aa-media-failure' ? [item(MEDIA, false), item(AA_SECOND, true)] : [item(ref, false)] };
}
async function aaUsable(control: Locator): Promise<void> {
  expect(await readable(control), 'canvas share aa reachable, visible and unobscured').toBe(true);
  const box = await control.boundingBox(); expect(box, 'canvas share aa native control box').not.toBeNull();
  expect(box!.width, 'canvas share aa touch target width').toBeGreaterThanOrEqual(43.5);
  expect(box!.height, 'canvas share aa touch target height').toBeGreaterThanOrEqual(43.5);
}
async function aaChangeToken(s: Session): Promise<void> {
  // Mark only this fixture's pending old metadata as an expected real AbortController cancellation.
  for (const request of s.pending) if (request.url() === s.origin + '/api/public/canvas-shares/' + TOKEN) s.expectedAbort.add(request);
  await s.page.evaluate(token => (window as unknown as FixtureWindow).routeUi.setToken(token), AA_NEXT);
  await frames(s.page);
}

async function aaCapture(s: Session, state: string): Promise<void> {
  if (s.page.viewportSize()?.width !== 390 || await s.page.locator('html').getAttribute('data-theme') !== 'dark') return;
  const folder = path.resolve('output/playwright/semantic-target-source-20261004/mobile-canvas-share-aa-20261019'); await mkdir(folder, { recursive: true });
  await s.page.screenshot({ path: path.join(folder, state + '-gold-390x844.png'), fullPage: true });
}

async function aaDownload(s: Session, control: Locator): Promise<void> {
  await aaUsable(control); const event = s.page.waitForEvent('download'); await control.click(); const result = await event;
  expect(result.suggestedFilename()).toBe('shared-canvas.png'); expect(await result.failure()).toBeNull();
  const stream = await result.createReadStream(); if (!stream) throw Error('AA_DOWNLOAD_STREAM_REQUIRED');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).equals(png), 'canvas share aa actual downloaded PNG bytes').toBe(true);
}

function rechargeReply(variant: string): Record<string, unknown> { return { success: true, balance: variant === 'paid-zero' ? 0 : 1200, order: { id: 'w-order', amount: 1200, priceCny: 12, bonus: 100, paymentMethod: 'wechat', paymentStatus: variant.startsWith('paid') ? 'paid' : variant === 'submitted' ? 'submitted' : variant === 'rejected' ? 'rejected' : 'pending', createdAt: 1, expiresAt: 2000000000000, isExpired: variant === 'expired', rejectReason: '合成审核说明_' + LONG }, payLink: variant === 'no-link' ? '' : ORIGIN + '/payment-do-not-open', note: '本地合成订单，不可支付_' + LONG }; }

function xRechargeReply(variant: string, requestNumber: number): Record<string, unknown> {
  if (variant === 'x-rejected') return rechargeReply('rejected');
  if (variant === 'x-paid-unknown') return { ...rechargeReply('paid-zero'), balance: null };
  if (variant === 'x-review-paid-null' || variant === 'x-review-paid-zero') return { ...rechargeReply(requestNumber === 1 ? 'submitted' : 'paid-zero'), balance: variant === 'x-review-paid-null' ? null : 0 };
  return rechargeReply(variant);
}


// AB owns only these synthetic UI responses; they never reach payment/accounting services.
function abRechargeReply(variant: string, requestNumber: number, next = false): Record<string, unknown> {
  const state = variant === 'ab-notify-already-paid' && requestNumber > 1 ? 'paid-zero' : variant === 'ab-review-rejected' ? (requestNumber === 1 ? 'submitted' : 'rejected')
    : variant === 'ab-expired-paid' ? 'paid-zero'
    : variant === 'ab-expired-submitted' ? 'submitted'
    : variant === 'ab-expired-rejected' ? 'rejected' : 'pending';
  const reply = rechargeReply(state), order = reply.order as Record<string, unknown>;
  return { ...reply, note: next ? '合成乙订单说明' : '合成甲订单说明', balance: state === 'paid-zero' && variant !== 'ab-notify-already-paid' ? 0 : null,
    payLink: variant === 'ab-qr-failure' ? ORIGIN + '/payment-do-not-open?q=' + 'q'.repeat(9000) : ORIGIN + '/payment-do-not-open',
    order: { ...order, id: next ? 'w-next-order' : 'w-order', amount: next ? 777 : variant === 'ab-qr-alipay-custom' ? 1337 : 1200,
      priceCny: next ? 7.77 : variant === 'ab-qr-alipay-custom' ? 13.37 : 12, bonus: variant === 'ab-qr-alipay-custom' ? 0 : 100,
      paymentMethod: variant === 'ab-qr-alipay-custom' ? 'alipay' : 'wechat',
      isExpired: variant.startsWith('ab-expired-'), rejectReason: '' } };
}

async function abRevealStable(s: Session, control: Locator): Promise<boolean> {
  // The original native helper may see one transient visible frame while the
  // replaced card/scrollport settles. Require a stable, fully readable target;
  // all movement still uses the original real wheel path, never DOM scrolling.
  const deadline = Date.now() + 1800;
  for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
    if (!await reveal(s, control)) return false;
    const before = await control.boundingBox(); await frames(s.page); await frames(s.page);
    const after = await control.boundingBox();
    if (!before || !after || !await readable(control)) continue;
    if (Math.abs(before.x - after.x) > 0.5 || Math.abs(before.y - after.y) > 0.5 || Math.abs(before.width - after.width) > 0.5 || Math.abs(before.height - after.height) > 0.5) continue;
    return true;
  }
  return false;
}

async function abCapture(s: Session, state: string): Promise<void> {
  if (s.page.viewportSize()?.width !== 390 || await s.page.locator('html').getAttribute('data-theme') !== 'dark') return;
  const folder = path.resolve('output/playwright/semantic-target-source-20261004/mobile-recharge-ab-20261019'); await mkdir(folder, { recursive: true });
  await s.page.screenshot({ path: path.join(folder, state + '-gold-390x844.png'), fullPage: true });
}

async function open(theme: Theme, width: number, height: number, options: Options): Promise<Session> {
  if (!browser) throw Error('W_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(1800);
  let release = (): void => { throw Error('W_GATE_INIT'); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  const s: Session = { origin: ORIGIN, downloadRequests: 0, downloadFinished: 0, context, page, options, faults: [], handlers: new Set(), pending: new Set(), counts: new Map(), expectedAbort: new Set(), blockedWs: [], mounted: false, closing: false, gate, release };
  live.add(s);
  if (options.surface === 'create' && options.variant === 'x-result-actions') {
    // The browser's native download transport did not enter .invalid routing.
    // Serve this one PNG only, on this context's ephemeral IPv4 loopback origin.
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/fixture/result.png' || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
        s.faults.push('X_UNKNOWN_LOOPBACK ' + request.method + ' ' + request.url); response.writeHead(404); response.end(); return;
      }
      s.downloadRequests++;
      response.once('finish', () => { s.downloadFinished++; });
      response.once('close', () => { if (!response.writableFinished) s.faults.push('X_LOOPBACK_RESPONSE_INCOMPLETE'); });
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(png.length), 'Cache-Control': 'no-store' }); response.end(png);
    });
    s.downloadServer = server;
    server.on('error', error => s.faults.push('X_LOOPBACK_ERROR ' + error.message));
    try {
      await bounded(new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }), 'loopback listen');
      const address = server.address() as AddressInfo | null;
      if (!address || address.address !== '127.0.0.1' || address.family !== 'IPv4' || address.port <= 0) throw Error('X_LOOPBACK_EXACT_BIND_REQUIRED');
      s.origin = 'http://127.0.0.1:' + address.port;
    } catch (error) { await dispose(s); throw error; }
  }


  if (options.surface === 'canvas-share' && options.variant === 'aa-download-allowed') {
    const exact = '/api/public/canvas-shares/' + TOKEN + '/media/' + MEDIA + '/download';
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== exact || (request.headers['content-length'] && request.headers['content-length'] !== '0') || s.downloadRequests >= 2) {
        s.faults.push('AA_UNKNOWN_LOOPBACK ' + request.method + ' ' + request.url); response.writeHead(404); response.end(); return;
      }
      s.downloadRequests++; response.once('finish', () => { s.downloadFinished++; });
      response.once('close', () => { if (!response.writableFinished) s.faults.push('AA_LOOPBACK_RESPONSE_INCOMPLETE'); });
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(png.length), 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename=shared-canvas.png' }); response.end(png);
    });
    s.downloadServer = server; server.on('error', error => s.faults.push('AA_LOOPBACK_ERROR ' + error.message));
    try {
      await bounded(new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }), 'AA loopback listen');
      const address = server.address() as AddressInfo | null;
      if (!address || address.address !== '127.0.0.1' || address.family !== 'IPv4' || address.port <= 0) throw Error('AA_LOOPBACK_BIND_REQUIRED');
      s.origin = 'http://127.0.0.1:' + address.port;
    } catch (error) { await dispose(s); throw error; }
  }
  if (options.surface === 'canvas-share' && ['aa-fullscreen-missing', 'aa-fullscreen-rejected'].includes(options.variant ?? '')) {
    await context.addInitScript(variant => {
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: variant === 'aa-fullscreen-missing' ? undefined : async (): Promise<never> => { throw new DOMException('Synthetic fullscreen denial', 'NotAllowedError'); } });
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: variant === 'aa-fullscreen-missing' ? undefined : async (): Promise<void> => undefined });
    }, options.variant);
  }

  page.on('pageerror', error => s.faults.push('PAGEERROR ' + error.message));
  page.on('request', request => s.pending.add(request));
  page.on('requestfinished', request => s.pending.delete(request));
  page.on('requestfailed', request => { s.pending.delete(request); if (!s.expectedAbort.has(request) && !(s.closing && request.url() === s.origin + '/api/task-events')) s.faults.push('NATIVE_FAILURE ' + request.method() + ' ' + request.url()); });
  await context.routeWebSocket('**/*', async socket => { if (!(options.boundary === 'ws' && socket.url() === s.origin.replace('https:', 'wss:') + '/unexpected')) s.faults.push('UNKNOWN_WS ' + socket.url()); s.blockedWs.push(socket.url()); await socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), key = request.method() + ' ' + url.pathname + url.search;
    const n = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, n);
    const run = async (): Promise<void> => {
      const variant = options.variant ?? 'ready';
      if (url.origin === s.origin && request.method() === 'GET' && request.postData() === null) {
        if (url.pathname === '/' && !url.search && request.isNavigationRequest() && n === 1) { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="route-root"></div></body></html>' }); return; }
        if (options.surface === 'create') {
          if (variant === 'y-restored-retry' && url.pathname === '/api/tasks/recover' && url.search === '?projectId=w-project' && n === 1) { await route.fulfill({ json: { success: true, tasks: [{ id: 'y-failed-task', projectId: 'w-project', type: 'generate-async', status: 'failed', providerId: 'w-b', model: 'w-image', progress: 0, prompt: '恢复前保存的合成提示词', error: '合成供应商暂时失败', recoveryAllowed: false, retryAfterMs: 0, nextRecoveryAt: 0, recoveryReason: 'terminal' }], retryAfterMs: 3000 } }); return; }

          if (url.pathname === '/api/session' && !url.search && n <= 8) { await route.fulfill({ json: { success: true, user: { id: 'w-user', name: '合成普通用户', role: 'user' } } }); return; }
          if (url.pathname === '/api/models' && url.search === '?type=image' && n === 1) { if (variant === 'loading') await gate; await route.fulfill(variant === 'models-error' ? { status: 503, json: { success: false } } : { json: variant === 'empty-models' ? { ...MODEL_REPLY, models: [] } : MODEL_REPLY }); return; }
          if (url.pathname === '/api/tasks/recover' && url.search === '?projectId=w-project' && n === 1) { const result = { assetProjection: { references: [{ url: '/fixture/result.png', assetVersionId: 'w-version', placementId: 'w-placement' }] } }; await route.fulfill(variant === 'restore-error' ? { status: 403, json: { error: '合成恢复拒绝' } } : { json: { tasks: (variant === 'empty' || ['x-reference', 'x-reference-busy', 'x-reference-error'].includes(variant)) ? [] : [{ id: 'w-task', slotId: 'w-slot', type: 'generate', projectId: 'w-project', status: variant === 'x-cancel' ? 'processing' : 'completed', progress: variant === 'x-cancel' ? 45 : 100, ...(variant === 'x-cancel' ? {} : { result }) }] } }); return; }
          if (url.pathname === '/api/task-events' && !url.search && n <= 8) { await route.fulfill({ contentType: 'text/event-stream', body: 'data: heartbeat\n\n' }); return; }
          if (url.pathname === '/fixture/result.png' && !url.search && (request.resourceType() === 'image' || variant === 'x-result-actions') && n <= 2) { await route.fulfill({ contentType: 'image/png', ...(variant === 'x-result-actions' && request.resourceType() !== 'image' ? { headers: { 'Content-Disposition': 'attachment; filename=w-slot.png' } } : {}), body: png }); return; }
        }

        if (options.surface === 'canvas-share' && variant.startsWith('aa-')) {
          const base = '/api/public/canvas-shares/';
          if ([base + TOKEN, base + AA_NEXT].includes(url.pathname) && !url.search && n <= 2) {
            const next = url.pathname === base + AA_NEXT;
            if ((variant === 'aa-token-ready-pending' && next) || (variant === 'aa-token-old-pending' && !next)) await gate;
            if (variant === 'aa-token-next-invalid' && next) { await route.fulfill({ status: 404, json: {} }); return; }
            if (variant === 'aa-error-network' && n === 1) { s.expectedAbort.add(request); await route.abort('connectionfailed'); return; }
            if (variant === 'aa-error-nonjson' && n === 1) { await route.fulfill({ status: 503, contentType: 'text/html', headers: { 'x-request-id': 'req_0123456789abcdef' }, body: '<p>SYNTHETIC_PRIVATE_ERROR</p>' }); return; }
            if (variant === 'aa-error-unsafe-id' && n === 1) { await route.fulfill({ status: 503, headers: { 'x-request-id': 'SYNTHETIC_PRIVATE_HEADER' }, json: { requestId: 'SYNTHETIC_PRIVATE_BODY', error: 'SYNTHETIC_PRIVATE_ERROR' } }); return; }
            await route.fulfill({ json: aaDocument(variant, next) }); return;
          }
          const media = [base + TOKEN + '/media/' + MEDIA, base + TOKEN + '/media/' + AA_SECOND, base + AA_NEXT + '/media/' + AA_SECOND];
          if (media.includes(url.pathname) && !url.search && n <= 8 && ['image', 'media'].includes(request.resourceType())) {
            if (variant === 'aa-media-failure' && url.pathname.endsWith('/' + MEDIA)) { await gate; await route.fulfill({ status: 404, contentType: 'image/png', body: Buffer.alloc(0) }); return; }
            await route.fulfill({ contentType: variant === 'aa-video' ? 'video/mp4' : 'image/png', body: variant === 'aa-video' ? aaFilm : png }); return;
          }
          if (variant === 'aa-download-allowed' && url.pathname === base + TOKEN + '/media/' + MEDIA + '/download' && !url.search && n <= 2) { await route.continue(); return; }
          // Never fall through to another scenario's more permissive metadata/media branch.
          s.faults.push('AA_UNKNOWN_HTTP ' + request.method() + ' ' + request.url()); s.expectedAbort.add(request); await route.abort('blockedbyclient'); return;
        }

        if (options.surface === 'canvas-share' && url.pathname === '/api/public/canvas-shares/' + TOKEN && !url.search && n <= 2) { if (variant === 'loading') await gate; if (variant === 'invalid') { await route.fulfill({ status: 404, json: {} }); return; } if (variant === 'error' && n === 1) { await route.fulfill({ status: 503, headers: { 'x-request-id': 'req_0123456789abcdef' }, json: {} }); return; } await route.fulfill({ json: documentReply(variant === 'empty') }); return; }
        if (options.surface === 'canvas-share' && url.pathname === '/api/public/canvas-shares/' + TOKEN + '/media/' + MEDIA && !url.search && n <= 3 && request.resourceType() === 'image') { await route.fulfill(options.variant === 'broken' ? { status: 404, contentType: 'image/png', body: Buffer.alloc(0) } : { contentType: 'image/png', body: png }); return; }

        if (options.surface === 'recharge' && variant.startsWith('ab-') && ['/api/recharge/w-order', '/api/recharge/w-next-order'].includes(url.pathname) && !url.search && n <= 4) {
          const next = url.pathname.endsWith('/w-next-order');
          if (next && variant !== 'ab-order-switch') throw Error('AB_UNEXPECTED_ORDER');
          if (next) await gate;
          if (variant === 'ab-anonymous') { await route.fulfill({ status: 401, json: { success: false, error: 'Authentication required' } }); return; }
          if (variant === 'ab-not-owner') { await route.fulfill({ status: 404, json: { success: false, error: '订单不存在' } }); return; }
          if (variant === 'ab-service') { await route.fulfill({ status: 503, json: { success: false, error: '订单服务暂不可用，请稍后再试', storageUnavailable: true } }); return; }
          if (variant === 'ab-nonjson') { await route.fulfill({ status: 503, contentType: 'text/html', body: '<p>SYNTHETIC_UPSTREAM_BODY</p>' }); return; }
          if (variant === 'ab-network') { s.expectedAbort.add(request); await route.abort('connectionfailed'); return; }
          await route.fulfill({ json: abRechargeReply(variant, n, next) }); return;
        }

        if (options.surface === 'recharge' && url.pathname === '/api/recharge/w-order' && !url.search && n <= 4) { if (variant === 'loading') await gate; await route.fulfill(variant === 'error' ? { status: 503, json: { success: false, error: '合成订单错误_' + LONG } } : { json: xRechargeReply(variant, n) }); return; }

        if (options.surface === 'create' && ['x-reference', 'x-reference-busy'].includes(variant) && /^\/fixture\/x-ref-[123]\.png$/.test(url.pathname) && !url.search && request.resourceType() === 'image' && n <= 2) { await route.fulfill({ contentType: 'image/png', body: png }); return; }
        const workspaceNavigation = (options.surface === 'recharge' && variant === 'x-rejected' && url.search === '?view=dashboard')
          || (options.surface === 'create' && variant === 'x-result-actions' && url.search === '?projectId=w-project&assetVersionId=w-version&placementId=w-placement');
        if (workspaceNavigation && url.pathname === '/' && request.isNavigationRequest() && n === 1) { s.expectedAbort.add(request); await route.abort('aborted'); return; }
      }

      if (url.origin === s.origin && request.method() === 'POST' && options.surface === 'create') {
        if (variant === 'y-restored-retry' && url.pathname === '/api/generate' && !url.search && n === 1) { const body = request.postDataJSON() as Record<string, unknown>; const want = {"retryTaskId":"y-failed-task","projectId":"w-project","outputCount":1,"n":1,"submitOnly":true}; const stable = (value: Record<string, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); if (request.headers()['content-type'] !== 'application/json' || stable(body) !== stable(want)) throw Error('Y_EXACT_OPAQUE_RETRY_REQUIRED'); await route.fulfill({ json: { success: true, taskId: 'y-new-task', taskIds: ['y-new-task'] } }); return; }
        if (variant === 'y-restored-retry' && url.pathname === '/api/poll-task' && !url.search && n <= 3 && request.postData() === '{"taskId":"y-new-task"}') { await route.fulfill({ json: { status: 'processing', progress: 10 } }); return; }

        if (['x-reference', 'x-reference-busy', 'x-reference-error'].includes(variant) && url.pathname === '/api/upload' && !url.search && n <= (variant === 'x-reference' ? 3 : 1)) {
          const contentType = request.headers()['content-type'] || '', bytes = request.postDataBuffer();
          if (!/^multipart\/form-data; boundary=/.test(contentType) || !bytes) throw Error('X_UPLOAD_MULTIPART_REQUIRED');
          const form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType } }).formData(), file = form.get('file');
          if (!file || typeof file === 'string' || form.getAll('file').length !== 1 || [...form.keys()].length !== 1 || !['x-1.png', 'x-2.png'].includes(file.name) || file.type !== 'image/png' || !Buffer.from(await file.arrayBuffer()).equals(png)) throw Error('X_UPLOAD_EXACT_PNG_REQUIRED');
          if (variant === 'x-reference-busy') await gate;
          await route.fulfill(variant === 'x-reference-error' ? { status: 503, json: { error: '合成上传拒绝' } } : { json: { url: '/fixture/x-ref-' + n + '.png' } }); return;
        }
        if (variant === 'x-cancel' && ['/api/cancel-task', '/api/poll-task'].includes(url.pathname) && !url.search && n <= (url.pathname === '/api/cancel-task' ? 1 : 4)) {
          const body = request.postDataJSON() as Record<string, unknown>;
          if (request.headers()['content-type'] !== 'application/json' || JSON.stringify(body) !== '{"taskId":"w-task"}') throw Error('X_CANCEL_EXACT_TASK_REQUIRED');
          await route.fulfill({ json: url.pathname === '/api/cancel-task' ? { success: true } : { status: (s.counts.get('POST /api/cancel-task') || 0) > 0 ? 'cancelled' : 'processing', progress: 45 } }); return;
        }
      }

      if (url.origin === s.origin && request.method() === 'POST' && options.surface === 'recharge' && variant.startsWith('ab-notify') && url.pathname === '/api/credits' && !url.search && n <= (variant === 'ab-notify-busy' ? 1 : 2)) {
        if (request.headers()['content-type'] !== 'application/json' || request.postData() !== '{"action":"confirm-paid","orderId":"w-order"}') throw Error('AB_EXACT_CONFIRM_PAID_BODY');
        if (variant === 'ab-notify-busy') await gate;
        if (variant === 'ab-notify-already-paid') { await route.fulfill({ json: { success: true, message: '订单已到账', alreadyPaid: true } }); return; }
        if (variant === 'ab-notify-already-submitted') { await route.fulfill({ json: { success: true, message: '已提交付款确认，等待管理员审核', alreadySubmitted: true } }); return; }
        if (n === 1 && variant === 'ab-notify-service') { await route.fulfill({ status: 503, json: { success: false, error: '合成付款通知暂不可用' } }); return; }
        if (n === 1 && variant === 'ab-notify-network') { s.expectedAbort.add(request); await route.abort('connectionfailed'); return; }
        if (n === 1 && variant === 'ab-notify-nonjson') { await route.fulfill({ status: 503, contentType: 'text/html', body: '<p>SYNTHETIC_NOTIFICATION_BODY</p>' }); return; }
        await route.fulfill({ json: { success: true, submitted: true, message: '合成通知已提交审核' } }); return;
      }

      if (options.boundary === 'post' && url.origin === s.origin && url.pathname === '/unexpected' && !url.search && request.method() === 'POST' && request.postData() === 'owned-probe' && n === 1) { s.expectedAbort.add(request); await route.abort('blockedbyclient'); return; }
      if (options.boundary === 'http' && url.origin === s.origin && url.pathname === '/unexpected' && request.method() === 'GET' && n === 1) { s.expectedAbort.add(request); await route.abort('blockedbyclient'); return; }
      s.faults.push('UNKNOWN_HTTP ' + request.method() + ' ' + request.url()); s.expectedAbort.add(request); await route.abort('blockedbyclient');
    };
    const operation = run(); s.handlers.add(operation); try { await operation; } catch (error) { s.faults.push('ROUTE_ERROR ' + String(error)); } finally { s.handlers.delete(operation); }
  });
  try {
    await page.goto(s.origin); await page.addScriptTag({ content: runtimeBundle }); await page.addScriptTag({ content: bundle }); await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).routeUi)); s.mounted = true;
    await page.evaluate(({ theme, options }) => (window as unknown as FixtureWindow).routeUi.mount(theme, options), { theme, options });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theme'));
    await page.getByRole('button', { name: '打开合成独立页面', exact: true }).click();
    if (options.variant !== 'loading' && options.variant !== 'aa-token-old-pending') {
      if (options.surface === 'create') await page.getByRole('heading', { name: '快速生图', exact: true }).waitFor();
      else if (options.surface === 'canvas-share') await page.waitForFunction(() => !document.querySelector('main[aria-busy="true"]'));
      else await page.getByRole('heading').first().waitFor();
    }
    await frames(page); return s;
  } catch (error) { try { await dispose(s); } catch (cleanup) { throw new AggregateError([error, cleanup], 'W_BOOT_AND_CLEANUP'); } throw error; }
}
async function drain(s: Session): Promise<void> { await bounded((async () => { while (s.handlers.size || s.pending.size) { await Promise.all([...s.handlers]); await frames(s.page); } await frames(s.page); })(), 'requests'); }
async function dispose(s: Session): Promise<void> {
  const errors: string[] = []; s.closing = true;
  try { s.release(); if (s.options.surface === 'canvas-share') await drain(s); if (s.mounted) await s.page.evaluate(() => (window as unknown as FixtureWindow).routeUi.unmount()); await frames(s.page); s.release(); await drain(s); if (s.mounted && !await s.page.evaluate(() => (window as unknown as FixtureWindow).routeUi.disposed)) errors.push('UNMOUNT_UNCONFIRMED'); } catch (error) { errors.push(String(error)); }
  finally { try { await bounded(s.context.close(), 'context close'); } catch (error) { errors.push(String(error)); } if (s.downloadServer?.listening) { try { await bounded(new Promise<void>((resolve, reject) => s.downloadServer!.close(error => error ? reject(error) : resolve())), 'loopback close'); } catch (error) { errors.push(String(error)); } } live.delete(s); }
  errors.push(...s.faults); if (errors.length) throw Error('W_CLEANUP ' + errors.join('\n'));
}
afterAll(async () => { const errors: string[] = []; for (const s of live) try { await dispose(s); } catch (error) { errors.push(String(error)); } await browser?.close(); browser = undefined; if (errors.length) throw Error(errors.join('\n')); }, 15000);
async function withPage(theme: Theme, width: number, height: number, options: Options, run: (s: Session) => Promise<void>): Promise<void> { const s = await open(theme, width, height, options); let primary: unknown; try { await run(s); } catch (error) { primary = error; } try { await dispose(s); } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'W_TEST_AND_CLEANUP'); throw cleanup; } if (primary) throw primary; }
async function readable(control: Locator): Promise<boolean> {
  const observation = await control.evaluate(element => {
    const selected = element.getAttribute('aria-label') === '关闭预览';
    const failures: Array<Record<string, unknown>> = [];
    const acBad = (reason: string, details: Record<string, unknown>): false => { if (selected && failures.length < 8) failures.push({ reason, ...details }); return false; };
    const result = ((): boolean => {
    const box = element.getBoundingClientRect();
    const clipped = (rect: DOMRect, node: Element): boolean => {
      let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right), top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom), opacity = 1;
      for (let parent: Element | null = node; parent; parent = parent.parentElement) {
        const bounds = parent.getBoundingClientRect(), css = getComputedStyle(parent); opacity *= Number(css.opacity);
        if (css.visibility !== 'visible' || css.display === 'none') return acBad('ancestor-style', { tag: parent.tagName, visibility: css.visibility, display: css.display });
        if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left = Math.max(left, bounds.left + parent.clientLeft); right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth); }
        if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top = Math.max(top, bounds.top + parent.clientTop); bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight); }
      }
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      const accepted = opacity > 0 && rect.width > 0 && rect.height > 0 && right - left >= rect.width - 0.5 && bottom - top >= rect.height - 0.5 && (hit === element || (hit !== null && element.contains(hit)));
      if (!accepted) acBad('clip-or-hit', { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, clip: { left, right, top, bottom }, opacity, hit: hit ? { tag: hit.tagName, aria: hit.getAttribute('aria-label'), slot: hit.getAttribute('data-slot') } : null, belongs: hit === element || (hit !== null && element.contains(hit)) });
      return accepted;
    };
    const own = getComputedStyle(element);
    if (Number(own.opacity) <= 0 || own.visibility !== 'visible' || own.display === 'none') return acBad('own-style', { opacity: own.opacity, visibility: own.visibility, display: own.display });
    if (!clipped(box, element.parentElement ?? element)) return acBad('own-clip', {});
    // Native select/textarea rendering has no exposed text-node glyph ranges.
    if (element.matches('select,textarea,input')) return true;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || !node.parentElement) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const glyph of range.getClientRects()) if (glyph.width > 0 && glyph.height > 0 && !clipped(glyph, node.parentElement)) return acBad('glyph-clip', { text: node.textContent?.trim() });
    }
    return true;

    })();
    return { result, failures, viewport: [innerWidth, innerHeight] };
  });
  if (!observation.result && observation.failures.length) console.log('AC_SAME_EVALUATION_READABILITY_FAILURE', JSON.stringify(observation));
  return observation.result;
}
async function reveal(s: Session, control: Locator): Promise<boolean> {
  for (let step = 0; step < 10; step++) {
    if (await readable(control)) return true;
    const point = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (!/auto|scroll/.test(css.overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
        let left = Math.max(0, rect.left + parent.clientLeft), right = Math.min(innerWidth, rect.left + parent.clientLeft + parent.clientWidth);
        let top = Math.max(0, rect.top + parent.clientTop), bottom = Math.min(innerHeight, rect.top + parent.clientTop + parent.clientHeight);
        for (let outer = parent.parentElement; outer; outer = outer.parentElement) {
          const bounds = outer.getBoundingClientRect(), style = getComputedStyle(outer);
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, bounds.top + outer.clientTop); bottom = Math.min(bottom, bounds.top + outer.clientTop + outer.clientHeight); }
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, bounds.left + outer.clientLeft); right = Math.min(right, bounds.left + outer.clientLeft + outer.clientWidth); }
        }
        const delta = box.top < top ? box.top - top - 8 : box.bottom > bottom ? box.bottom - bottom + 8 : 0;
        if (right <= left || bottom <= top || delta === 0 || (delta < 0 && parent.scrollTop <= 0) || (delta > 0 && parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 1)) continue;
        return { x: (left + right) / 2, y: (top + bottom) / 2, delta };
      }
      return null;
    });
    if (!point) return false;
    await s.page.mouse.move(point.x, point.y); await s.page.mouse.wheel(0, point.delta); await frames(s.page);
  }
  return await readable(control);
}
async function capture(s: Session, name: string): Promise<void> { const dir = path.resolve('output/playwright/standalone-routes-native-20261019', String(process.pid)); await mkdir(dir, { recursive: true }); await s.page.screenshot({ path: path.join(dir, name + '.png') }); }
const SURFACES: Surface[] = ['create', 'canvas-share', 'recharge'];
describe('standalone routes w fixture', () => {
  it.each(SURFACES)('%s uses original component and real media', async surface => { await withPage('gold', 390, 844, { surface }, async s => { if (surface === 'create') { expect(await s.page.getByLabel('模型', { exact: true }).inputValue()).toBe('w-a::w-image'); expect(await s.page.getByRole('button', { name: '下载 w-slot', exact: true }).count()).toBe(1); } if (surface === 'canvas-share') expect(await s.page.getByRole('region', { name: '共享画布视口' }).count()).toBe(1); if (surface === 'recharge') await s.page.getByAltText('支付二维码', { exact: true }).waitFor(); const images = s.page.locator('img'); expect(await images.count()).toBeGreaterThan(0); expect(await images.evaluateAll(elements => Promise.all(elements.map(async element => { await (element as HTMLImageElement).decode(); return (element as HTMLImageElement).naturalWidth > 0; })))).not.toContain(false); }); }, 25000);
  it('rejects unknown HTTP before external transport', async () => { await withPage('gold', 390, 844, { surface: 'recharge', boundary: 'http' }, async s => { expect(await s.page.evaluate(async () => { try { await fetch('/unexpected'); return false; } catch { return true; } })).toBe(true); expect(s.expectedAbort.size).toBe(1); }); }, 25000);
  it('rejects unknown WS before external transport', async () => { await withPage('gold', 390, 844, { surface: 'recharge', boundary: 'ws' }, async s => { expect(await s.page.evaluate(() => new Promise<boolean>(resolve => { const socket = new WebSocket(location.origin.replace('https:', 'wss:') + '/unexpected'); socket.addEventListener('close', () => resolve(true), { once: true }); }))).toBe(true); expect(s.blockedWs).toEqual([ORIGIN.replace('https:', 'wss:') + '/unexpected']); }); }, 25000);
  it('detects glyph clipping even when the complete control box is visible', async () => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'loading' }, async s => {
      await s.page.evaluate(() => { const host = document.createElement('aside'); host.id = 'w-probe'; host.style.cssText = 'position:fixed;top:40px;left:24px;width:260px;height:160px;background:white;z-index:100'; const button = document.createElement('button'); button.textContent = '可见外框但内部文字不可读'; button.style.cssText = 'width:160px;height:44px;white-space:nowrap;overflow:hidden;padding-left:145px'; host.append(button); document.body.append(host); });
      expect(await readable(s.page.locator('#w-probe button'))).toBe(false);
    });
  }, 25000);
  it('uses native nested scrolling against the scrollport rather than the window', async () => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'loading' }, async s => {
      await s.page.evaluate(() => { const host = document.createElement('aside'); host.id = 'w-probe'; host.style.cssText = 'position:fixed;top:40px;left:24px;width:260px;height:180px;overflow-y:auto;background:white;z-index:100'; const spacer = document.createElement('div'); spacer.style.height = '300px'; const button = document.createElement('button'); button.textContent = '内层底部按钮'; button.style.cssText = 'width:160px;height:44px;display:block'; host.append(spacer, button); document.body.append(host); });
      const button = s.page.locator('#w-probe button'); expect(await readable(button)).toBe(false);
      expect(await reveal(s, button)).toBe(true); expect(await s.page.locator('#w-probe').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    });
  }, 25000);

});
describe('standalone routes w layout', () => {
  for (const surface of SURFACES) for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[320, 640], [390, 844], [640, 320], [1440, 900]] as const) {
    it(surface + ' ' + theme + ' ' + width + 'x' + height + ' preserves readable reachable controls', async () => { await withPage(theme, width, height, { surface, variant: surface === 'canvas-share' ? 'error' : 'ready' }, async s => {
      await capture(s, surface + '-' + theme + '-' + width + 'x' + height);
      const size = await s.page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      expect(size.root, 'standalone routes w document fits width').toBeLessThanOrEqual(size.width + 1); expect(size.body, 'standalone routes w body fits width').toBeLessThanOrEqual(size.width + 1);
      if (surface === 'create') await s.page.getByLabel('提示词', { exact: true }).fill('本地移动端草稿，不发送');
      const rows: Array<{ label: string; reached: boolean; width: number; height: number; font: number; input: boolean }> = [];
      for (const control of await s.page.locator('button,select,textarea,a[href]').all()) { const reached = await reveal(s, control); const measure = await control.evaluate(element => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height, font: parseFloat(getComputedStyle(element).fontSize), input: element.matches('select,textarea,input') }; }); rows.push({ ...measure, reached }); }
      const finalContent = surface === 'create' ? s.page.getByRole('button', { name: '下载 w-slot', exact: true }) : surface === 'canvas-share' ? s.page.getByRole('button', { name: '重新加载', exact: true }) : s.page.getByText('订单号：', { exact: false });
      const endReachable = await reveal(s, finalContent);
      await capture(s, surface + '-' + theme + '-' + width + 'x' + height + '-end');
      console.log('W_CLIP_PROBE',JSON.stringify(await s.page.locator('main[data-simple-create-page],body > #route-root').first().evaluate(root=>({root:{tag:root.tagName,height:root.clientHeight,scrollHeight:root.scrollHeight,overflow:getComputedStyle(root).overflow},ancestors:[...document.querySelectorAll('main,body,html')].map(e=>({tag:e.tagName,overflowY:getComputedStyle(e).overflowY,height:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop})),footer:[...document.querySelectorAll('span')].filter(e=>e.textContent?.startsWith('订单号')).map(e=>({text:e.textContent,box:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,parent:e.parentElement?.getBoundingClientRect().toJSON()}))}))));
      console.log('W_NATIVE_LAYOUT', JSON.stringify({ surface, theme, width, height, rows, endReachable }));
      expect(rows.filter(row => !row.reached), 'standalone routes w every original control reachable by native scroll').toEqual([]);
      expect(rows.filter(row => row.width < 44 || row.height < 44), 'standalone routes w original controls retain 44px targets').toEqual([]);
      expect(rows.filter(row => width < 768 && row.input && row.font < 16), 'standalone routes w mobile inputs use 16px text').toEqual([]);
      expect(endReachable, 'standalone routes w final content remains natively reachable').toBe(true);
    }); }, 25000);
  }
});


// W state matrix: actual original GET paths only; no upload/generation/payment POSTs.
describe('standalone routes w states', () => {
  const cases: Array<{ surface: Surface; variant: string }> = [
    ...['loading', 'missing', 'empty-models', 'models-error', 'empty', 'restore-error'].map(variant => ({ surface: 'create' as const, variant })),
    ...['loading', 'invalid', 'error', 'empty', 'ready', 'broken'].map(variant => ({ surface: 'canvas-share' as const, variant })),
    ...['loading', 'error', 'paid-zero', 'submitted', 'rejected', 'expired', 'no-link', 'returned'].map(variant => ({ surface: 'recharge' as const, variant })),
  ];
  for (const options of cases) for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[390, 844], [640, 320]] as const) {
    it(options.surface + ' ' + options.variant + ' ' + theme + ' ' + width + 'x' + height + ' preserves its original state and reachable controls', async () => {
      await withPage(theme, width, height, options, async s => {
        const { surface, variant } = options;
        let state: Locator;
        if (variant === 'loading') {
          state = surface === 'create' ? s.page.getByLabel('正在加载', { exact: true }) : surface === 'canvas-share' ? s.page.getByText('正在加载分享…', { exact: true }) : s.page.getByText('加载中...', { exact: true });
          await state.waitFor();
          expect(await readable(state), 'standalone routes w loading marker readable').toBe(true);
          s.release();
          if (surface === 'create') await s.page.getByLabel('模型', { exact: true }).waitFor();
          if (surface === 'canvas-share') await s.page.getByRole('region', { name: '共享画布视口' }).waitFor();
          if (surface === 'recharge') await s.page.getByRole('heading', { name: '无界AI 积分充值', exact: true }).waitFor();
          return;
        }
        if (surface === 'create') {
          if (variant === 'missing' || variant === 'empty-models' || variant === 'models-error') {
            const copy = variant === 'missing' ? '请先选择一个项目' : variant === 'empty-models' ? '当前账号没有可用的图像模型' : '模型能力目录不可用';
            state = s.page.getByRole('alert'); expect(await state.textContent(), 'standalone routes w original error copy').toBe(copy);
            expect(await s.page.getByLabel('模型', { exact: true }).count(), 'standalone routes w no unauthorized model control').toBe(0);
          } else {
            state = s.page.getByLabel('提示词', { exact: true });
            expect(await s.page.getByRole('region', { name: '生成结果' }).count(), 'standalone routes w empty or failed restore stays empty').toBe(0);
            const model = s.page.getByLabel('模型', { exact: true });
            expect(await model.locator('option').allTextContents(), 'standalone routes w provider model pair labels').toEqual(['合成供应商甲 · 同名图像', '合成供应商乙 · 同名图像']);
            expect(await reveal(s, model), 'standalone routes w model switch reachable').toBe(true);
            await model.selectOption('w-b::w-image'); expect(await model.inputValue()).toBe('w-b::w-image');
            await state.fill('本地草稿，不提交'); expect(await state.inputValue()).toBe('本地草稿，不提交');
          }
        } else if (surface === 'canvas-share') {
          if (variant === 'invalid') {
            state = s.page.getByRole('heading', { name: '分享不存在或已失效', exact: true });
            expect(await s.page.getByRole('button', { name: '重新加载', exact: true }).count()).toBe(0);
          } else if (variant === 'error') {
            state = s.page.getByRole('button', { name: '重新加载', exact: true });
            expect(await reveal(s, state), 'standalone routes w share retry reachable').toBe(true); await state.click();
            await s.page.getByRole('region', { name: '共享画布视口' }).waitFor();
            expect(s.counts.get('GET /api/public/canvas-shares/' + TOKEN), 'standalone routes w exactly one retry').toBe(2);
            state = s.page.getByRole('heading', { name: '合成只读画布', exact: true });
          } else if (variant === 'empty') state = s.page.getByText('此分享暂无可显示内容', { exact: true });
          else if (variant === 'broken') state = s.page.getByText('此内容暂不可用', { exact: true });
          else {
            const zoom = s.page.getByRole('button', { name: '放大画布', exact: true }), scale = s.page.getByLabel('当前比例', { exact: true });
            const before = await scale.textContent(); expect(await reveal(s, zoom), 'standalone routes w zoom reachable').toBe(true); await zoom.click(); expect(await scale.textContent(), 'standalone routes w zoom action changes original viewport').not.toBe(before);
            await s.page.getByRole('button', { name: '适应画面', exact: true }).click();
            const preview = s.page.getByRole('button', { name: '预览合成海报', exact: true }); await preview.click();
            const dialog = s.page.getByRole('dialog', { name: '媒体预览', exact: true }); await dialog.waitFor(); await bounded(dialog.evaluate(async element => { let settled = 0; while (settled < 2) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (!element.isConnected) throw Error('W_PREVIEW_DETACHED_DURING_ENTRANCE'); settled = element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running' || animation.pending) ? 0 : settled + 1; } }), 'preview entrance'); await frames(s.page);
            const close = s.page.getByRole('button', { name: '关闭预览', exact: true }); expect(await readable(close), 'standalone routes w preview close readable').toBe(true); await close.click();
            await dialog.waitFor({ state: 'detached' }); expect(await preview.evaluate(element => element === document.activeElement), 'standalone routes w preview restores focus').toBe(true);
            state = s.page.getByRole('heading', { name: '合成只读画布', exact: true });
          }
        } else {
          const heading = variant === 'error' ? '加载失败' : variant === 'paid-zero' ? '充值成功！' : variant === 'submitted' ? '等待审核' : variant === 'rejected' ? '审核未通过' : variant === 'expired' ? '订单已过期' : '无界AI 积分充值';
          state = s.page.getByRole('heading', { name: heading, exact: true });
          if (variant === 'paid-zero') expect(await s.page.getByText('0 积分', { exact: true }).count(), 'standalone routes w zero balance is not missing').toBe(1);
          if (variant === 'no-link') {
            expect(await s.page.getByText('支付链接未配置，请联系管理员', { exact: true }).count()).toBe(1);
            expect(await s.page.getByAltText('支付二维码', { exact: true }).count()).toBe(0);
          }
          if (variant === 'returned') { expect(await s.page.getByRole('button', { name: '我已完成付款', exact: true }).count(), 'standalone routes w original return action restored').toBe(1); }
          const paragraphs = s.page.locator('p').filter({ hasText: LONG });
          for (const paragraph of await paragraphs.all()) {
            const fits = await paragraph.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
            expect(fits, 'standalone routes w long original state copy not horizontally clipped').toBe(true);
          }
        }
        expect(await reveal(s, state), 'standalone routes w state copy natively readable').toBe(true);
        for (const control of await s.page.locator('button:not([data-shared-media]),select,textarea,a[href]').all()) {
          if (!await control.isVisible()) continue;
          expect(await reveal(s, control), 'standalone routes w state control natively reachable').toBe(true);
          const box = await control.boundingBox(); expect(box && box.width >= 44 && box.height >= 44, 'standalone routes w state control target').toBe(true);
        }
        const size = await s.page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        expect(Math.max(size.root, size.body), 'standalone routes w state document fits width').toBeLessThanOrEqual(size.width + 1);
      });
    }, 25000);
  }
});


// Reviewer counterexamples: painted geometry must include the control's own style.
describe('standalone routes w opacity', () => {
  it.each(['button', 'select', 'textarea'] as const)('%s cannot pass when its own opacity is zero', async tag => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'loading' }, async s => {
      await s.page.evaluate(tag => {
        const host = document.createElement('aside'); host.id = 'w-opacity'; host.style.cssText = 'position:fixed;top:40px;left:24px;width:260px;height:160px;background:white;z-index:100';
        const control = document.createElement(tag); control.setAttribute('aria-label', '自身透明度反例'); control.style.cssText = 'display:block;width:160px;height:44px;opacity:0';
        if (control instanceof HTMLSelectElement) { const option = document.createElement('option'); option.textContent = '原生模型'; control.append(option); }
        if (control instanceof HTMLTextAreaElement) control.value = '原生草稿';
        host.append(control); document.body.append(host);
      }, tag);
      const control = s.page.locator('#w-opacity').locator(tag);
      expect(await readable(control), 'standalone routes w own opacity zero is not readable').toBe(false);
      await control.evaluate(element => { (element as HTMLElement).style.opacity = '1'; }); await frames(s.page);
      expect(await readable(control), 'standalone routes w own opacity restored is readable').toBe(true);
    });
  }, 25000);
});


// X: original browser handlers; exact .invalid payloads only. File-choice is
// programmatic, not a hardware picker. Navigation is recorded before commit.
async function xUpload(s: Session, name: 'x-1.png' | 'x-2.png'): Promise<void> {
  await s.page.getByLabel('参考图', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: png });
}
async function xDecodedReferences(s: Session, count: number): Promise<void> {
  const images = s.page.getByAltText('参考图已上传', { exact: true });
  await expect.poll(() => images.count(), { timeout: 1800 }).toBe(count);
  expect(await images.evaluateAll(elements => Promise.all(elements.map(async element => { const image = element as HTMLImageElement; await image.decode(); return image.naturalWidth === 320 && image.naturalHeight === 240; }))), 'standalone operations x reference media really decodes').not.toContain(false);
}
async function xWorkspaceRequested(s: Session, query: string): Promise<void> {
  const started = Date.now(); while ((s.counts.get('GET /' + query) ?? 0) !== 1 && Date.now() - started < 1800) await frames(s.page);
  expect(s.counts.get('GET /' + query) ?? 0, 'standalone operations x original handler requests existing workspace').toBe(1);
  expect(s.page.url(), 'standalone operations x navigation stays isolated before commit').toBe(s.origin + '/');
  expect(s.expectedAbort.size, 'standalone operations x exactly one owned navigation blocked').toBe(1);
}
describe('standalone operations x transport', () => {
  it('original upload sends exact multipart PNG and previews actual bytes', async () => {
    await withPage('gold', 390, 844, { surface: 'create', variant: 'x-reference' }, async s => {
      await xUpload(s, 'x-1.png'); await xDecodedReferences(s, 1);
      expect(s.counts.get('POST /api/upload')).toBe(1);
      expect(await s.page.getByLabel('参考图', { exact: true }).inputValue()).toBe('');
    });
  }, 25000);
  it('workspace request is rejected before unloading original tree', async () => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'x-rejected' }, async s => {
      await s.page.evaluate(() => { const anchor = document.createElement('a'); anchor.id = 'x-nav-probe'; anchor.href = '/?view=dashboard'; anchor.textContent = '隔离导航探针'; anchor.style.cssText = 'position:fixed;left:8px;top:8px;width:180px;height:44px;z-index:10000;background:white;color:black'; document.body.append(anchor); });
      await s.page.locator('#x-nav-probe').click(); await xWorkspaceRequested(s, '?view=dashboard');
      expect(await s.page.getByRole('heading', { name: '审核未通过', exact: true }).count()).toBe(1);
    });
  }, 25000);
  it('unknown mutating request cannot escape owned transport', async () => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'x-rejected', boundary: 'post' }, async s => {
      expect(await s.page.evaluate(async () => { try { await fetch('/unexpected', { method: 'POST', body: 'owned-probe' }); return false; } catch { return true; } })).toBe(true);
      expect(s.expectedAbort.size).toBe(1);
    });
  }, 25000);
});


describe('standalone operations x balance', () => {
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[390, 844], [640, 320]] as const) {
    it('unknown ' + theme + ' ' + width + 'x' + height + ' does not invent a zero balance for unknown server balance', async () => {
      await withPage(theme, width, height, { surface: 'recharge', variant: 'x-paid-unknown' }, async s => {
        await s.page.getByRole('heading', { name: '充值成功！', exact: true }).waitFor();
        await capture(s, 'x-balance-' + theme + '-' + width + 'x' + height);
        expect(await s.page.getByText('-- 积分', { exact: true }).count(), 'standalone operations x null balance remains unknown').toBe(1);
        expect(await s.page.getByText('0 积分', { exact: true }).count(), 'standalone operations x null is not zero').toBe(0);
      });
    }, 25000);
    for (const row of [{ variant: 'x-review-paid-null', want: '-- 积分' }, { variant: 'x-review-paid-zero', want: '0 积分' }]) {
      it('refresh ' + row.variant + ' ' + theme + ' ' + width + 'x' + height + ' keeps authoritative balance distinction', async () => {
        await withPage(theme, width, height, { surface: 'recharge', variant: row.variant }, async s => {
          const refresh = s.page.getByRole('button', { name: '刷新状态', exact: true });
          expect(await reveal(s, refresh), 'standalone operations x refresh reachable').toBe(true); await refresh.click();
          await s.page.getByRole('heading', { name: '充值成功！', exact: true }).waitFor();
          expect(await s.page.getByText(row.want, { exact: true }).count(), 'standalone operations x refresh preserves null versus zero').toBe(1);
          expect(s.counts.get('GET /api/recharge/w-order')).toBe(2);
          expect(s.counts.get('POST /api/credits') ?? 0).toBe(0);
        });
      }, 25000);
    }
  }
  for (const row of [{ variant: 'x-review-paid-null', want: '-- 积分', theme: 'gold' as const }, { variant: 'x-review-paid-zero', want: '0 积分', theme: 'mono' as const }]) {
    it('poll ' + row.variant + ' uses the original five-second timer without payment mutations', async () => {
      await withPage(row.theme, 390, 844, { surface: 'recharge', variant: row.variant }, async s => {
        await s.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor();
        await s.page.getByRole('heading', { name: '充值成功！', exact: true }).waitFor({ timeout: 7500 });
        expect(await s.page.getByText(row.want, { exact: true }).count(), 'standalone operations x polling preserves null versus zero').toBe(1);
        expect(s.counts.get('GET /api/recharge/w-order')).toBe(2);
        expect(s.counts.get('POST /api/credits') ?? 0).toBe(0);
      });
    }, 25000);
  }
});
for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[390, 844], [640, 320]] as const) {
  describe('standalone operations x recharge', () => {
    it(theme + ' ' + width + 'x' + height + ' rejected recovery never reuses terminal order', async () => {
      await withPage(theme, width, height, { surface: 'recharge', variant: 'x-rejected' }, async s => {
        const heading = s.page.getByRole('heading', { name: '审核未通过', exact: true }); await heading.waitFor();
        const recovery = heading.locator('..').locator('button,a[href]'); expect(await recovery.count()).toBe(1);
        expect(await reveal(s, recovery), 'standalone operations x rejected recovery reachable').toBe(true);
        await capture(s, 'x-rejected-' + theme + '-' + width + 'x' + height);

        const contrast = await recovery.evaluate(element => {
          const css = getComputedStyle(element);
          const channels = (value: string): number[] => { if (!/^rgba?\(/.test(value)) throw Error('X_COLOR_FORMAT_REQUIRED'); return value.match(/[\d.]+/g)!.slice(0, 3).map(Number); };
          const luminance = (rgb: number[]): number => rgb.map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          const a = luminance(channels(css.color)), b = luminance(channels(css.backgroundColor));
          return { foreground: css.color, background: css.backgroundColor, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
        console.log('X_RECOVERY_CONTRAST', JSON.stringify(contrast));
        expect(contrast.ratio, 'standalone operations x recovery text contrast at least 4.5').toBeGreaterThanOrEqual(4.5);

        await recovery.click(); await xWorkspaceRequested(s, '?view=dashboard');
        expect(s.counts.get('POST /api/credits') ?? 0, 'standalone operations x old order never resubmitted').toBe(0);
        expect(s.counts.get('GET /payment-do-not-open') ?? 0, 'standalone operations x old payment link never followed').toBe(0);
      });
    }, 25000);
  });
  describe('standalone operations x reference', () => {
    it('cycle ' + theme + ' ' + width + 'x' + height + ' original limit removal and reselection work', async () => {
      await withPage(theme, width, height, { surface: 'create', variant: 'x-reference' }, async s => {
        const input = s.page.getByLabel('参考图', { exact: true });
        await xUpload(s, 'x-1.png'); await xDecodedReferences(s, 1);
        await xUpload(s, 'x-2.png'); await xDecodedReferences(s, 2);
        expect(await input.isDisabled(), 'standalone operations x administrator reference limit enforced').toBe(true);
        const remove = s.page.getByRole('button', { name: '移除参考图 1', exact: true }); expect(await reveal(s, remove), 'standalone operations x remove reachable').toBe(true);
        await capture(s, 'x-reference-' + theme + '-' + width + 'x' + height);
        const box = await remove.boundingBox();
        await remove.click(); await xDecodedReferences(s, 1);
        expect(await s.page.getByAltText('参考图已上传', { exact: true }).evaluateAll(elements => elements.map(element => element.getAttribute('src'))), 'standalone operations x remove retains second asset identity').toEqual(['/fixture/x-ref-2.png']);
        expect(await input.isDisabled()).toBe(false);
        await xUpload(s, 'x-1.png'); await xDecodedReferences(s, 2);
        expect(s.counts.get('POST /api/upload'), 'standalone operations x original same-file reselection works').toBe(3);
        expect(await s.page.getByAltText('参考图已上传', { exact: true }).evaluateAll(elements => elements.map(element => element.getAttribute('src'))), 'standalone operations x reselection keeps ordered asset identities').toEqual(['/fixture/x-ref-2.png', '/fixture/x-ref-3.png']);
        expect(box && box.width >= 44 && box.height >= 44, 'standalone operations x remove retains 44px target').toBe(true);
      });
    }, 25000);
    it('busy ' + theme + ' ' + width + 'x' + height + ' generation waits for uploading reference', async () => {
      await withPage(theme, width, height, { surface: 'create', variant: 'x-reference-busy' }, async s => {
        const prompt = s.page.getByLabel('提示词', { exact: true }), generate = s.page.getByRole('button', { name: '开始生成', exact: true });
        await prompt.fill('带参考图的本地草稿'); expect(await generate.isEnabled()).toBe(true);
        await xUpload(s, 'x-1.png');
        await expect.poll(() => s.counts.get('POST /api/upload') ?? 0, { timeout: 1800 }).toBe(1);
        await s.page.getByText('正在上传', { exact: true }).waitFor();
        expect(await s.page.getByLabel('参考图', { exact: true }).isDisabled()).toBe(true);
        await reveal(s, generate); await capture(s, 'x-reference-busy-' + theme + '-' + width + 'x' + height);
        expect(await generate.isDisabled(), 'standalone operations x busy reference blocks generation').toBe(true);
        s.release(); await xDecodedReferences(s, 1);
        await expect.poll(() => generate.isEnabled(), { timeout: 1800 }).toBe(true);
        expect(await prompt.inputValue()).toBe('带参考图的本地草稿');
        expect(s.counts.get('POST /api/generate') ?? 0).toBe(0);
      });
    }, 25000);
    it('error ' + theme + ' ' + width + 'x' + height + ' upload rejection preserves original draft', async () => {
      await withPage(theme, width, height, { surface: 'create', variant: 'x-reference-error' }, async s => {
        const prompt = s.page.getByLabel('提示词', { exact: true }); await prompt.fill('上传失败也要保留的本地草稿');
        await xUpload(s, 'x-1.png'); const alert = s.page.getByRole('alert'); await alert.waitFor();
        expect(await alert.textContent()).toBe('合成上传拒绝'); expect(await prompt.inputValue()).toBe('上传失败也要保留的本地草稿');
        expect(await s.page.getByLabel('参考图', { exact: true }).isDisabled()).toBe(false);
        expect(await s.page.getByAltText('参考图已上传', { exact: true }).count()).toBe(0);
        expect(s.counts.get('POST /api/generate') ?? 0).toBe(0);
      });
    }, 25000);
  });
  describe('standalone operations x cancel', () => {
    it(theme + ' ' + width + 'x' + height + ' original cancellation reaches cancelled', async () => {
      await withPage(theme, width, height, { surface: 'create', variant: 'x-cancel' }, async s => {
        const cancel = s.page.getByRole('button', { name: '取消 w-slot', exact: true });
        expect(await reveal(s, cancel), 'standalone operations x original cancel reachable').toBe(true); await cancel.click();
        await s.page.getByText('已取消', { exact: true }).waitFor();
        expect(s.counts.get('POST /api/cancel-task')).toBe(1);
        expect(await cancel.count()).toBe(0); expect(s.counts.get('POST /api/generate') ?? 0).toBe(0);
      });
    }, 25000);
  });
  describe('standalone operations x result', () => {
    it(theme + ' ' + width + 'x' + height + ' original download bytes and managed canvas request remain intact', async () => {
      await withPage(theme, width, height, { surface: 'create', variant: 'x-result-actions' }, async s => {
        const download = s.page.getByRole('button', { name: '下载 w-slot', exact: true });
        expect(await reveal(s, download), 'standalone operations x download reachable').toBe(true);
        const event = s.page.waitForEvent('download'); await download.click(); const received = await event;
        expect(received.suggestedFilename()).toBe('w-slot.png'); expect(await received.failure()).toBeNull();
        const stream = await received.createReadStream(); if (!stream) throw Error('X_NATIVE_DOWNLOAD_STREAM_REQUIRED');
        const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).equals(png), 'standalone operations x original download returns real PNG').toBe(true);
        expect(s.downloadRequests).toBe(1); expect(s.downloadFinished).toBe(1);
        const canvas = s.page.getByRole('button', { name: '在画布中打开 w-slot', exact: true });
        expect(await reveal(s, canvas), 'standalone operations x canvas result action reachable').toBe(true); await canvas.click();
        await xWorkspaceRequested(s, '?projectId=w-project&assetVersionId=w-version&placementId=w-placement');
        expect(s.counts.get('POST /api/generate') ?? 0).toBe(0);
      });
    }, 25000);
  });
}


describe('standalone operations x download diagnostic', () => {
  it('ordinary attached same-origin anchor establishes the owned download fixture', async () => {
    await withPage('gold', 390, 844, { surface: 'create', variant: 'x-result-actions' }, async s => {
      const events: string[] = [], downloads: Download[] = [], completions: Array<Promise<string | null>> = []; s.page.on('download', received => { events.push(received.suggestedFilename()); downloads.push(received); completions.push(received.failure()); });
      await s.page.getByAltText('生成结果', { exact: true }).evaluate(async element => { await (element as HTMLImageElement).decode(); });
      await s.page.evaluate(() => { const anchor = document.createElement('a'); anchor.id = 'x-download-probe'; anchor.href = '/fixture/result.png'; anchor.download = 'x-probe.png'; anchor.rel = 'noopener'; anchor.textContent = '隔离下载探针'; anchor.style.cssText = 'position:fixed;left:8px;top:8px;width:180px;height:44px;z-index:10000;background:white;color:black'; document.body.append(anchor); });
      try { await s.page.locator('#x-download-probe').click(); await expect.poll(() => events.length, { timeout: 1800 }).toBe(1); expect(await Promise.all(completions)).toEqual([null]);
        const stream = await downloads[0].createReadStream(); if (!stream) throw Error('X_CONTROL_DOWNLOAD_STREAM_REQUIRED');
        const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).equals(png), 'standalone operations x native anchor control bytes match PNG').toBe(true);
        expect(s.downloadRequests).toBe(1); expect(s.downloadFinished).toBe(1); }
      finally { console.log('X_DOWNLOAD_DIAGNOSTIC', JSON.stringify({ events, url: s.page.url(), requests: [...s.counts], loopbackRequests: s.downloadRequests, loopbackFinished: s.downloadFinished })); }
    });
  }, 25000);
});


describe('standalone retry y restored', () => {
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[390, 844], [640, 320]] as const) {
    it(theme + ' ' + width + 'x' + height + ' retries the stored task rather than the current form', async () => {
      await withPage(theme, width, height, { surface: 'create', variant: 'y-restored-retry' }, async s => {
        const model = s.page.getByLabel('模型', { exact: true }); expect(await model.inputValue()).toBe('w-a::w-image');
        await s.page.getByLabel('提示词', { exact: true }).fill('当前表单不能替代历史请求');
        const retry = s.page.getByRole('button', { name: /^重试 / });
        expect(await retry.count()).toBe(1); expect(await reveal(s, retry), 'standalone retry y restored reachable').toBe(true);
        await retry.click();
        const deadline = Date.now() + 1800; while ((s.counts.get('POST /api/generate') ?? 0) === 0 && Date.now() < deadline) await frames(s.page);
        expect(s.counts.get('POST /api/generate') ?? 0, 'standalone retry y restored must submit the frozen retry, not remain a silent no-op').toBe(1);
        await s.page.getByText('生成中', { exact: true }).waitFor();
        expect(await s.page.getByRole('button', { name: /^重试 / }).count()).toBe(0);
        expect(s.counts.get('POST /api/credits') ?? 0).toBe(0);
      });
    }, 25000);
  }
});



describe('canvas share aa native operations', () => {
  const variants = ['aa-token-ready-pending', 'aa-token-old-pending', 'aa-token-next-invalid', 'aa-error-network', 'aa-error-nonjson', 'aa-error-unsafe-id', 'aa-media-preview', 'aa-media-failure', 'aa-video', 'aa-download-allowed', 'aa-download-denied', 'aa-fullscreen-missing', 'aa-fullscreen-rejected', 'aa-gesture-interrupt'];
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[320, 640], [390, 844], [640, 320]] as const) for (const variant of variants) {
    it(theme + ' ' + width + 'x' + height + ' ' + variant, async () => {
      await withPage(theme, width, height, { surface: 'canvas-share', variant }, async s => {
        const viewport = s.page.getByRole('region', { name: '共享画布视口' });
        const preview = s.page.getByRole('dialog', { name: '媒体预览' });
        const poster = s.page.getByRole('button', { name: '预览合成海报', exact: true });
        const globalDownload = s.page.getByRole('link', { name: '下载当前内容', exact: true });
        const previewDownload = s.page.getByRole('link', { name: '下载预览内容', exact: true });
        const close = s.page.getByRole('button', { name: '关闭预览', exact: true });
        if (variant.startsWith('aa-token-')) {
          if (variant === 'aa-token-old-pending') {
            await s.page.getByText('正在加载分享…', { exact: true }).waitFor();
            await expect.poll(() => s.counts.get('GET /api/public/canvas-shares/' + TOKEN) ?? 0, { timeout: 1800 }).toBe(1);
          } else { await poster.click(); await preview.waitFor(); }
          await aaChangeToken(s);
          expect(await preview.count(), 'canvas share aa old preview hidden on token change').toBe(0);
          expect(await s.page.getByRole('heading', { name: '分享甲', exact: true }).count()).toBe(0);
          if (variant === 'aa-token-ready-pending') {
            await s.page.getByText('正在加载分享…', { exact: true }).waitFor();
            expect(await viewport.count()).toBe(0); expect(await globalDownload.count()).toBe(0);
            expect(await s.page.locator('img').count(), 'canvas share aa no old media while next share pending').toBe(0);
            s.release();
          }
          if (variant === 'aa-token-next-invalid') {
            await s.page.getByRole('heading', { name: '分享不存在或已失效', exact: true }).waitFor();
            expect(await s.page.locator('img,a[download]').count()).toBe(0);
            expect(await s.page.getByRole('button', { name: '重新加载', exact: true }).count()).toBe(0);
          } else {
            await s.page.getByRole('heading', { name: '分享乙', exact: true }).waitFor();
            s.release(); await drain(s);
            expect(await s.page.getByRole('heading', { name: '分享甲', exact: true }).count()).toBe(0);
            const sources = await s.page.locator('img').evaluateAll(elements => elements.map(element => element.getAttribute('src')));
            expect(sources).toEqual(['/api/public/canvas-shares/' + AA_NEXT + '/media/' + AA_SECOND]);
            expect(await globalDownload.count(), 'canvas share aa new viewer must not inherit old selection').toBe(0);
          }
          expect(s.counts.get('GET /api/public/canvas-shares/' + TOKEN)).toBe(1);
          expect(s.counts.get('GET /api/public/canvas-shares/' + AA_NEXT)).toBe(1);
        } else if (variant.startsWith('aa-error-')) {
          await s.page.getByRole('alert').waitFor();
          if (variant === 'aa-error-nonjson') await aaCapture(s, 'aa-nonjson-error');
          expect((await s.page.locator('body').innerText()).includes('SYNTHETIC_PRIVATE')).toBe(false);
          if (variant === 'aa-error-nonjson') expect(await s.page.getByText('请求标识：req_0123456789abcdef', { exact: true }).count()).toBe(1);
          if (variant === 'aa-error-unsafe-id') expect((await s.page.locator('body').innerText()).includes('请求标识：')).toBe(false);
          const retry = s.page.getByRole('button', { name: '重新加载', exact: true }); await aaUsable(retry); await retry.click();
          await viewport.waitFor(); await s.page.locator('img').evaluateAll(elements => Promise.all(elements.map(element => (element as HTMLImageElement).decode())));
          expect(s.counts.get('GET /api/public/canvas-shares/' + TOKEN)).toBe(2);
        } else if (variant === 'aa-media-failure') {
          await poster.click(); await preview.waitFor(); s.release();
          await s.page.getByText('此内容暂不可用', { exact: true }).waitFor();
          await expect.poll(() => preview.count(), { timeout: 1800 }).toBe(0);
          expect(await poster.count()).toBe(0); await s.page.getByRole('button', { name: '适应画面', exact: true }).click();
          const second = s.page.getByRole('button', { name: '预览合成副图', exact: true }); await aaUsable(second); await second.click();
          await preview.waitFor(); expect(await preview.locator('img').evaluate(async element => { await (element as HTMLImageElement).decode(); return (element as HTMLImageElement).naturalWidth; })).toBe(320);
          await close.click(); await expect.poll(() => preview.count(), { timeout: 1800 }).toBe(0);
        } else if (variant === 'aa-fullscreen-missing' || variant === 'aa-fullscreen-rejected') {
          const fullscreen = s.page.getByRole('button', { name: '进入全屏', exact: true });
          if (variant === 'aa-fullscreen-missing') expect(await fullscreen.count()).toBe(0);
          else { await aaUsable(fullscreen); await fullscreen.click(); await s.page.getByText('无法进入全屏，请使用浏览器菜单重试。', { exact: true }).waitFor(); expect(await s.page.evaluate(() => document.fullscreenElement)).toBeNull(); }
          await s.page.getByRole('button', { name: '放大画布', exact: true }).click();
          expect(await s.page.getByLabel('当前比例', { exact: true }).innerText()).toBe('120%');
        } else if (variant === 'aa-gesture-interrupt') {
          // Native Chromium mouse/capture lifecycle; touch-specific double taps live in the separate typed-pointer suite.
          const box = await viewport.boundingBox(); if (!box) throw Error('AA_VIEWPORT_BOX_REQUIRED');
          const x = box.x + box.width - 30, y = box.y + 30;
          await viewport.evaluate(element => {
            element.addEventListener('pointerdown', event => { element.setAttribute('data-aa-pointer', String((event as PointerEvent).pointerId)); }, { once: true });
            element.addEventListener('lostpointercapture', () => { element.setAttribute('data-aa-capture-lost', 'true'); }, { once: true });
          });
          await s.page.mouse.move(x, y); await s.page.mouse.down();
          try {
            await s.page.mouse.move(x + 4, y); await frames(s.page);
            const moved = await s.page.getByTestId('shared-canvas-content').getAttribute('data-offset-x');
            expect(Number(moved), 'canvas share aa native pointer initially pans').toBe(4);
            expect(await viewport.evaluate(element => element.hasPointerCapture(Number(element.getAttribute('data-aa-pointer'))))).toBe(true);
            await viewport.evaluate(element => element.releasePointerCapture(Number(element.getAttribute('data-aa-pointer'))));
            await s.page.mouse.move(x + 5, y);
            await expect.poll(() => viewport.getAttribute('data-aa-capture-lost'), { timeout: 1800 }).toBe('true');
            await s.page.mouse.move(x + 20, y); await frames(s.page);
            expect(await s.page.getByTestId('shared-canvas-content').getAttribute('data-offset-x'), 'canvas share aa lost capture ends native pan').toBe(moved);
            expect(await s.page.getByLabel('当前比例', { exact: true }).innerText()).toBe('100%');
          } finally { await s.page.mouse.up(); }
        } else {
          expect(await globalDownload.count(), 'canvas share aa requires explicit selection before download').toBe(0);
          const mediaButton = variant === 'aa-video' ? s.page.getByRole('button', { name: '预览合成视频', exact: true }) : poster;
          await aaUsable(mediaButton); await mediaButton.click(); await preview.waitFor(); await aaUsable(close);
          if (variant === 'aa-media-preview') await aaCapture(s, 'aa-media-dialog');
          if (variant === 'aa-video') {
            const film = preview.locator('video');
            await expect.poll(() => film.evaluate(element => (element as HTMLVideoElement).readyState), { timeout: 1800 }).toBeGreaterThanOrEqual(2);
            const attributes = await film.evaluate(element => { const video = element as HTMLVideoElement; return { width: video.videoWidth, height: video.videoHeight, muted: video.muted, inline: video.playsInline, controls: video.controls, autoplay: video.autoplay }; });
            expect(attributes).toEqual({ width: 160, height: 90, muted: true, inline: true, controls: true, autoplay: false });
            await film.evaluate(element => (element as HTMLVideoElement).play());
            await expect.poll(() => film.evaluate(element => (element as HTMLVideoElement).currentTime), { timeout: 1800 }).toBeGreaterThan(0);
            await film.evaluate(element => (element as HTMLVideoElement).pause());
            expect(await film.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
          } else expect(await preview.locator('img').evaluate(async element => { await (element as HTMLImageElement).decode(); return (element as HTMLImageElement).naturalWidth; })).toBe(320);
          if (variant === 'aa-download-allowed') await aaDownload(s, previewDownload);
          if (variant === 'aa-download-denied') expect(await previewDownload.count()).toBe(0);
          if (variant === 'aa-media-preview') {
            await previewDownload.focus(); await s.page.keyboard.press('Shift+Tab'); expect(await close.evaluate(element => element === document.activeElement)).toBe(true);
            await s.page.keyboard.press('Tab'); expect(await previewDownload.evaluate(element => element === document.activeElement)).toBe(true);
            await s.page.keyboard.press('Escape');
          } else await close.click();
          await expect.poll(() => preview.count(), { timeout: 1800 }).toBe(0);
          await expect.poll(() => mediaButton.evaluate(element => element === document.activeElement), { timeout: 1800 }).toBe(true);
          if (variant === 'aa-download-allowed') { await aaDownload(s, globalDownload); expect(s.downloadRequests).toBe(2); expect(s.downloadFinished).toBe(2); }
          if (variant === 'aa-download-denied') expect(await globalDownload.count()).toBe(0);
          if (variant === 'aa-media-preview') {
            await mediaButton.click(); await preview.waitFor(); await s.page.goBack();
            await expect.poll(() => preview.count(), { timeout: 1800 }).toBe(0);
            expect(s.page.url()).toBe(s.origin + '/');
          }
        }
        expect([...s.counts.keys()].every(key => key.startsWith('GET ')), 'canvas share aa read-only outgoing requests').toBe(true);
        expect(s.blockedWs).toEqual([]); expect(s.faults).toEqual([]);
        expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1), 'canvas share aa no document overflow').toBe(true);

      });
    }, 25000);
  }
});



describe('recharge ab native operations', () => {
  const variants = ['ab-anonymous', 'ab-not-owner', 'ab-service', 'ab-nonjson', 'ab-network', 'ab-notify-busy', 'ab-notify-service', 'ab-notify-network', 'ab-notify-nonjson', 'ab-notify-already-paid', 'ab-notify-already-submitted', 'ab-review-rejected', 'ab-expired-paid', 'ab-expired-submitted', 'ab-expired-rejected', 'ab-qr-alipay-custom', 'ab-qr-failure', 'ab-order-switch'];
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[320, 640], [390, 844], [640, 320]] as const) for (const variant of variants) {
    it(theme + ' ' + width + 'x' + height + ' ' + variant, async () => {
      await withPage(theme, width, height, { surface: 'recharge', variant }, async s => {
        const body = s.page.locator('body'), notify = s.page.getByRole('button', { name: '我已完成付款', exact: true });
        if (['ab-anonymous', 'ab-not-owner', 'ab-service', 'ab-nonjson', 'ab-network'].includes(variant)) {
          expect(await s.page.getByRole('heading', { name: '加载失败', exact: true }).count()).toBe(1);
          const want = variant === 'ab-anonymous' ? 'Authentication required' : variant === 'ab-not-owner' ? '订单不存在' : variant === 'ab-service' ? '订单服务暂不可用，请稍后再试' : '网络错误，请刷新重试';
          expect((await body.innerText()).includes(want), 'recharge ab native preserves safe failure feedback').toBe(true);
          expect((await body.innerText()).includes('SYNTHETIC_UPSTREAM_BODY')).toBe(false);
          expect(await s.page.getByRole('link', { name: /^立即支付/ }).count()).toBe(0); expect(await notify.count()).toBe(0);
        } else if (variant.startsWith('ab-notify')) {
          expect(await reveal(s, notify), 'recharge ab native returned order notice reachable').toBe(true); await aaUsable(notify); await notify.click();
          if (variant === 'ab-notify-already-paid') {
            const deadline = Date.now() + 1800; while (await s.page.getByRole('heading', { name: '充值成功！', exact: true }).count() === 0 && Date.now() < deadline) await frames(s.page);
            expect(await s.page.getByRole('heading', { name: '充值成功！', exact: true }).count(), 'recharge ab native already-paid notice refreshes authoritative metadata promptly').toBe(1);
            expect(await s.page.getByText('-- 积分', { exact: true }).count()).toBe(1);
            expect(s.counts.get('GET /api/recharge/w-order')).toBe(2); expect(s.counts.get('POST /api/credits')).toBe(1);
          } else if (variant === 'ab-notify-already-submitted') {
            await s.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor(); expect(s.counts.get('POST /api/credits')).toBe(1);
          } else if (variant === 'ab-notify-busy') {
            const busy = s.page.getByRole('button', { name: '提交中...', exact: true }); await busy.waitFor(); expect(await busy.isDisabled()).toBe(true);
            const box = await busy.boundingBox(); if (!box) throw Error('AB_BUSY_BOX_REQUIRED');
            await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await frames(s.page);
            expect(s.counts.get('POST /api/credits')).toBe(1); await abCapture(s, 'ab-notify-busy'); s.release();
          } else {
            const want = variant === 'ab-notify-service' ? '合成付款通知暂不可用' : '网络错误，请重试';
            await s.page.getByText(want, { exact: true }).waitFor(); expect(await notify.isEnabled()).toBe(true);
            expect((await body.innerText()).includes('SYNTHETIC_NOTIFICATION_BODY')).toBe(false);
            expect((await body.innerText()).includes('合成甲订单说明'), 'recharge ab native failed notice keeps order information').toBe(true);
            if (variant === 'ab-notify-service') await abCapture(s, 'ab-notify-service-error');
            expect(await reveal(s, notify)).toBe(true); await notify.click();
          }
          if (variant !== 'ab-notify-already-paid') await s.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor();
          expect(s.counts.get('POST /api/credits')).toBe(['ab-notify-busy', 'ab-notify-already-paid', 'ab-notify-already-submitted'].includes(variant) ? 1 : 2);
          expect(await notify.count()).toBe(0); const refresh = s.page.getByRole('button', { name: '刷新状态', exact: true }); if (variant !== 'ab-notify-already-paid') { expect(await abRevealStable(s, refresh), 'recharge ab native stable native-scroll reachability').toBe(true); await aaUsable(refresh); }
        } else if (variant === 'ab-review-rejected') {
          await s.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor();
          const refresh = s.page.getByRole('button', { name: '刷新状态', exact: true }); expect(await reveal(s, refresh)).toBe(true); await refresh.click();
          const deadline = Date.now() + 1800; while (await s.page.getByRole('heading', { name: '审核未通过', exact: true }).count() === 0 && Date.now() < deadline) await frames(s.page);
          expect(await s.page.getByRole('heading', { name: '审核未通过', exact: true }).count(), 'recharge ab native manual refresh must leave waiting on rejected response').toBe(1);
          expect((await body.innerText()).includes('未收到对应款项，请确认支付成功后重新提交')).toBe(true);
          const back = s.page.getByRole('link', { name: '返回工作台重新充值', exact: true }); expect(await reveal(s, back)).toBe(true); await aaUsable(back);
          expect(await back.getAttribute('href')).toBe('/?view=dashboard'); expect(s.counts.get('GET /api/recharge/w-order')).toBe(2);
          // Actual AppRouter arrival is intentionally not claimed by this isolated component fixture.
        } else if (variant.startsWith('ab-expired-')) {
          const want = variant === 'ab-expired-paid' ? '充值成功！' : variant === 'ab-expired-submitted' ? '等待审核' : '审核未通过';
          expect(await s.page.getByRole('heading', { name: want, exact: true }).count(), 'recharge ab native authoritative payment state precedes expiry').toBe(1);
          expect(await s.page.getByRole('heading', { name: '订单已过期', exact: true }).count()).toBe(0);
          if (variant === 'ab-expired-paid') expect(await s.page.getByText('0 积分', { exact: true }).count()).toBe(1);
          expect(await s.page.getByRole('link', { name: /^立即支付/ }).count()).toBe(0); expect(await notify.count()).toBe(0);
        } else if (variant === 'ab-order-switch') {
          expect((await body.innerText()).includes('合成甲订单说明')).toBe(true);
          await s.page.evaluate(() => (window as unknown as FixtureWindow).routeUi.setOrder('w-next-order'));
          await expect.poll(() => s.counts.get('GET /api/recharge/w-next-order') ?? 0, { timeout: 1800 }).toBe(1); await frames(s.page);
          expect((await body.innerText()).includes('合成甲订单说明'), 'recharge ab native new pending order must immediately hide old order').toBe(false);
          expect(await s.page.getByRole('link', { name: /^立即支付/ }).count()).toBe(0);
          s.release(); await s.page.getByText('合成乙订单说明', { exact: false }).waitFor();
          expect((await body.innerText()).includes('合成甲订单说明')).toBe(false); expect((await body.innerText()).includes('777')).toBe(true);
          expect(s.counts.get('GET /api/recharge/w-order')).toBe(1); expect(s.counts.get('GET /api/recharge/w-next-order')).toBe(1);
        } else {
          const pay = s.page.getByRole('link', { name: /^立即支付/ }); expect(await reveal(s, pay)).toBe(true); await aaUsable(pay);
          if (variant === 'ab-qr-alipay-custom') {
            const qr = s.page.getByAltText('支付二维码', { exact: true }); await qr.waitFor();
            expect(await s.page.evaluate(() => ({ settled: (window as unknown as FixtureWindow).routeUi.qrSettled, rejected: (window as unknown as FixtureWindow).routeUi.qrRejected }))).toEqual({ settled: 1, rejected: 0 });
            expect(await qr.evaluate(async element => { await (element as HTMLImageElement).decode(); return (element as HTMLImageElement).naturalWidth; })).toBe(200);
            expect((await body.innerText()).includes('支付宝')).toBe(true); expect((await body.innerText()).includes('自定义 1337 积分')).toBe(true);
            expect((await body.innerText()).includes('+100赠')).toBe(false); await abCapture(s, 'ab-alipay-custom');
          } else {
            // Real QR encoder rejects the over-capacity synthetic URL; payment navigation is never clicked.
            await s.page.waitForFunction(() => (window as unknown as FixtureWindow).routeUi.qrSettled === 1);
            expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).routeUi.qrRejected)).toBe(1);
            expect(await s.page.getByAltText('支付二维码', { exact: true }).count()).toBe(0);
            expect((await pay.getAttribute('href'))!.length).toBeGreaterThan(9000);
          }
        }
        expect([...s.counts.keys()].every(key => key.startsWith('GET /') || (variant.startsWith('ab-notify') && key === 'POST /api/credits')), 'recharge ab native only exact synthetic reads/notice POST').toBe(true);
        expect(s.blockedWs).toEqual([]); expect(s.faults).toEqual([]);
        expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'recharge ab native no horizontal overflow').toBe(true);
      });
    }, 25000);
  }
});


// AC: listed original computed-contrast cases and isolated measurement calibration.
// Reuses that file's real Session/Locator/withPage/reveal/readable/frames/LONG.
// No imports, production edits, fixture edits, screenshots, or new transport rules.
// Regression: enabled payment text and auxiliary copy become unreadable when their
// foreground alpha decreases or the actual background changes. Product AA supplies
// 4.5 independently; only >=24px, or bold >=14pt, may use the large-text 3.0 rule.

interface AcRechargeContrastTarget {
  name: string;
  locator: Locator;
  action?: boolean;
}

interface AcRechargeContrastCase {
  theme: Theme;
  width: number;
  height: number;
  variant: string;
}

interface AcRechargeContrastFailure {
  target: string;
  outcome: 'UNVERIFIED' | 'BELOW_AA';
  ratio: number | null;
  required: number;
  issues: string[];
}

interface AcRechargeContrastConversion {
  source: string;
  input: string;
  method: 'exact-srgb' | 'browser-srgb-8bit';
  rgba: [number, number, number, number];
  bytes: [number, number, number, number] | null;
  quantizationBoundary: { byteMin: number; byteMax: number; normalizedStep: number; note: string } | null;
}

interface AcRechargeContrastLayer {
  node: string;
  background: string;
  rgba: [number, number, number, number] | null;
  image: string;
  opacity: string;
  blend: string;
  backgroundBlend: string;
  filter: string;
  backdropFilter: string;
}

interface AcRechargeContrastSample {
  text: string;
  foreground: string;
  font: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  requiredRatio: number;
  chain: AcRechargeContrastLayer[];
  background: [number, number, number, number];
  paintedText: [number, number, number, number] | null;
  ratio: number | null;
  issues: string[];
  conversionMethod: 'exact-srgb' | 'browser-srgb-8bit';
  colorConversions: AcRechargeContrastConversion[];
}

async function acRechargeContrast(control: Locator): Promise<AcRechargeContrastSample> {
  return await control.evaluate((element): AcRechargeContrastSample => {
    type Rgba = [number, number, number, number]; // sRGB channels and alpha, all 0..1.
    interface NativeSrgbCanvasCapabilities {
      getContextAttributes?: () => { colorSpace?: string } | null | undefined;
    }
    const issues: string[] = [];
    const colorConversions: AcRechargeContrastConversion[] = [];
    const numeric = (token: string, percentScale: number): number => {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(token)) throw Error('AC_COLOR_NUMBER ' + token);
      const value = Number.parseFloat(token) * (token.endsWith('%') ? percentScale / 100 : 1);
      if (!Number.isFinite(value)) throw Error('AC_COLOR_NUMBER ' + token);
      return value;
    };
    const parse = (value: string, source: string): Rgba => {
      if (value === 'transparent') {
        const rgba: Rgba = [0, 0, 0, 0];
        colorConversions.push({ source, input: value, method: 'exact-srgb', rgba, bytes: null, quantizationBoundary: null });
        return rgba;
      }
      const match = /^(rgb|rgba|color|oklab|oklch)\(([^()]*)\)$/i.exec(value.trim());
      if (!match) throw Error('AC_UNHANDLED_COLOR ' + value);
      const mode = match[1].toLowerCase(), parts = match[2].split('/');
      if (parts.length > 2) throw Error('AC_UNHANDLED_COLOR ' + value);
      if (mode === 'oklab' || mode === 'oklch') {
        // Use the browser's native conversion, including its own gamut mapping
        // and RGBA8 alpha quantization. Never invert a hand-written Lab matrix.
        if (typeof OffscreenCanvas === 'undefined' || !CSS.supports('color', value)) throw Error('AC_UNHANDLED_BROWSER_COLOR ' + value);
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
        if (!context) throw Error('AC_UNHANDLED_CANVAS_SRGB');
        const nativeContext = context as OffscreenCanvasRenderingContext2D & NativeSrgbCanvasCapabilities;
        if (typeof nativeContext.getContextAttributes !== 'function' || nativeContext.getContextAttributes()?.colorSpace !== 'srgb') throw Error('AC_UNHANDLED_CANVAS_SRGB');
        // Two different sentinels detect a rejected fillStyle assignment even
        // if one happens to equal a valid input. Neither sentinel is painted.
        context.fillStyle = '#010203'; context.fillStyle = value;
        const accepted = context.fillStyle;
        context.fillStyle = '#040506'; context.fillStyle = value;
        if (context.fillStyle !== accepted) throw Error('AC_UNHANDLED_CANVAS_COLOR ' + value);
        context.clearRect(0, 0, 1, 1);
        context.globalAlpha = 1; context.globalCompositeOperation = 'copy';
        context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1, { colorSpace: 'srgb' });
        if (pixel.colorSpace !== 'srgb' || !(pixel.data instanceof Uint8ClampedArray) || pixel.data.length !== 4) throw Error('AC_UNHANDLED_CANVAS_RGBA8');
        const bytes: [number, number, number, number] = [pixel.data[0], pixel.data[1], pixel.data[2], pixel.data[3]];
        const rgba: Rgba = [bytes[0] / 255, bytes[1] / 255, bytes[2] / 255, bytes[3] / 255];
        colorConversions.push({ source, input: value, method: 'browser-srgb-8bit', rgba, bytes, quantizationBoundary: {
          byteMin: 0, byteMax: 255, normalizedStep: 1 / 255,
          note: 'Native unpremultiplied sRGB RGBA8 output; alpha 0.5 is 128/255. Browser gamut mapping and premultiplication can lose source precision, especially at low alpha. No sub-byte/source-gamut or <=0.5-byte RGB error proof; no AA threshold tolerance.',
        } });
        return rgba;
      }
      const tokens = parts[0].trim().replace(/,/g, ' ').split(/\s+/);
      let alpha = parts[1] === undefined ? 1 : numeric(parts[1].trim(), 1);
      if ((mode === 'rgb' || mode === 'rgba') && parts.length === 1 && tokens.length === 4) alpha = numeric(tokens.pop()!, 1);
      let rgb: number[];
      if (mode === 'color') {
        if (tokens.shift()?.toLowerCase() !== 'srgb' || tokens.length !== 3) throw Error('AC_UNHANDLED_COLOR_SPACE ' + value);
        rgb = tokens.map(token => numeric(token, 1));
      } else {
        if (tokens.length !== 3) throw Error('AC_UNHANDLED_COLOR ' + value);
        rgb = tokens.map(token => token.endsWith('%') ? numeric(token, 1) : numeric(token, 1) / 255);
      }
      if (alpha < 0 || alpha > 1 || rgb.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)) throw Error('AC_UNHANDLED_COLOR_RANGE ' + value);
      const rgba: Rgba = [rgb[0], rgb[1], rgb[2], alpha];
      colorConversions.push({ source, input: value, method: 'exact-srgb', rgba, bytes: null, quantizationBoundary: null });
      return rgba;
    };
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha,
      ];
    };
    const luminance = (rgba: Rgba): number => rgba.slice(0, 3).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const css = getComputedStyle(element), fontSize = Number.parseFloat(css.fontSize), fontWeight = Number(css.fontWeight);
    if (!css.fontSize.endsWith('px') || !Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(fontWeight)) issues.push('AC_UNHANDLED_FONT');
    const requiredRatio = fontSize >= 24 || (fontSize >= 14 * 96 / 72 && fontWeight >= 700) ? 3.0 : 4.5;
    // A selected enabled action must stay available. Low color alpha is never a
    // disabled heuristic; the submitting/disabled state is not in this matrix.
    if (element.closest(':disabled,[aria-disabled="true"],[inert]')) issues.push('AC_SELECTED_TARGET_NOT_ENABLED');
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    const chain: AcRechargeContrastLayer[] = [];
    let background: Rgba = [0, 0, 0, 0]; // Never assume a white/black browser canvas.
    for (const node of ancestors) {
      const style = getComputedStyle(node), label = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className ? '.' + String(node.className).trim().replace(/\s+/g, '.') : '');
      const backdropFilter = style.getPropertyValue('backdrop-filter') || style.getPropertyValue('-webkit-backdrop-filter') || 'none';
      let rgba: Rgba | null = null;
      try { rgba = parse(style.backgroundColor, label + '.backgroundColor'); } catch (error) { issues.push(label + ': ' + String(error)); }
      chain.push({ node: label, background: style.backgroundColor, rgba, image: style.backgroundImage, opacity: style.opacity, blend: style.mixBlendMode, backgroundBlend: style.backgroundBlendMode, filter: style.filter, backdropFilter });
      if (style.backgroundImage !== 'none') issues.push(label + ': AC_UNHANDLED_BACKGROUND_IMAGE ' + style.backgroundImage);
      if (Number(style.opacity) !== 1) issues.push(label + ': AC_UNHANDLED_GROUP_OPACITY ' + style.opacity);
      if (style.mixBlendMode !== 'normal' || style.backgroundBlendMode.split(',').some(mode => mode.trim() !== 'normal')) issues.push(label + ': AC_UNHANDLED_BLEND');
      if (style.filter !== 'none' || backdropFilter !== 'none') issues.push(label + ': AC_UNHANDLED_FILTER');
      if ((style.getPropertyValue('mask-image') || 'none') !== 'none' || (style.getPropertyValue('-webkit-mask-image') || 'none') !== 'none') issues.push(label + ': AC_UNHANDLED_MASK');
      if (style.backgroundClip === 'text' || /inset/.test(style.boxShadow) || style.textShadow !== 'none') issues.push(label + ': AC_UNHANDLED_TEXT_PAINT');
      if (style.visibility !== 'visible' || style.display === 'none') issues.push(label + ': AC_NOT_VISIBLE');
      for (const pseudo of ['::before', '::after']) {
        const generated = getComputedStyle(node, pseudo);
        if (!['none', 'normal'].includes(generated.content) && generated.display !== 'none') issues.push(label + pseudo + ': AC_UNHANDLED_GENERATED_PAINT');
      }
      // Root -> body -> page -> card -> translucent panel -> target, in paint order.
      if (rgba) background = over(rgba, background);
    }
    if (background[3] !== 1) issues.push('AC_NO_OPAQUE_SOLID_BACKDROP');
    const fill = css.getPropertyValue('-webkit-text-fill-color');
    if (fill && fill !== css.color) issues.push('AC_UNHANDLED_TEXT_FILL ' + fill);
    const stroke = Number.parseFloat(css.getPropertyValue('-webkit-text-stroke-width') || '0');
    if (stroke !== 0) issues.push('AC_UNHANDLED_TEXT_STROKE');
    // These targets have uniform textual runs (BR is harmless). Refuse to assign
    // a parent's ratio to differently styled descendants introduced by a change.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || !node.parentElement) continue;
      const run = getComputedStyle(node.parentElement);
      if (run.color !== css.color || run.fontSize !== css.fontSize || run.fontWeight !== css.fontWeight || (node.parentElement !== element && (run.backgroundImage !== 'none' || run.backgroundColor !== 'rgba(0, 0, 0, 0)' || Number(run.opacity) !== 1 || run.filter !== 'none'))) issues.push('AC_UNHANDLED_MIXED_TEXT_RUN');
    }
    let paintedText: Rgba | null = null, ratio: number | null = null;
    try {
      const foreground = parse(css.color, 'target.color');
      if (issues.length === 0) {
        paintedText = over(foreground, background);
        const a = luminance(paintedText), b = luminance(background);
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (!Number.isFinite(ratio)) { issues.push('AC_NONFINITE_RATIO'); ratio = null; }
      }
    } catch (error) { issues.push(String(error)); }
    const conversionMethod = colorConversions.some(conversion => conversion.method === 'browser-srgb-8bit') ? 'browser-srgb-8bit' : 'exact-srgb';
    return { text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(), foreground: css.color, font: css.font, fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight, requiredRatio, chain, background, paintedText, ratio, issues, conversionMethod, colorConversions };
  });
}

async function acRunRechargeContrastTargets(s: Session, scenario: AcRechargeContrastCase, targets: readonly AcRechargeContrastTarget[]): Promise<void> {
  const { theme, width, height, variant } = scenario;
  const samples: Array<AcRechargeContrastSample & { target: string }> = [];
  for (const target of targets) {
    await target.locator.waitFor();
    expect(await target.locator.count(), 'recharge ac contrast unique present target: ' + target.name).toBe(1);
    if (target.action) expect(await target.locator.isEnabled(), 'recharge ac contrast action available: ' + target.name).toBe(true);
    expect(await reveal(s, target.locator), 'recharge ac contrast original real-wheel reachability: ' + target.name).toBe(true);
    // Move the real pointer off the card so a wheel reveal does not leave
    // an accidental CTA hover. No CSS or scroll-position writes.
    await s.page.mouse.move(0, 0); await frames(s.page);
    expect(await readable(target.locator), 'recharge ac contrast readable at measurement: ' + target.name).toBe(true);
    const sample = { ...await acRechargeContrast(target.locator), target: target.name };
    samples.push(sample);
    console.log('RECHARGE_AC_CONTRAST', JSON.stringify({ theme, width, height, variant, ...sample }));
  }
  // An unsupported target is an explicit failure (unverified), never a skip
  // or a guessed PASS. Measure every present target before reporting ratios.
  const failures = samples.flatMap<AcRechargeContrastFailure>(sample => sample.issues.length > 0 || sample.ratio === null
    ? [{ target: sample.target, outcome: 'UNVERIFIED', ratio: sample.ratio, required: sample.requiredRatio, issues: sample.issues }]
    : sample.ratio < sample.requiredRatio
      ? [{ target: sample.target, outcome: 'BELOW_AA', ratio: sample.ratio, required: sample.requiredRatio, issues: sample.issues }]
      : []);
  expect([...s.counts.keys()].sort(), 'recharge ac contrast exact original read-only fixture HTTP').toEqual(['GET /', 'GET /api/recharge/w-order']);
  expect(s.blockedWs).toEqual([]); expect(s.faults).toEqual([]);
  expect(failures, 'recharge ac contrast computed text must meet normal 4.5 / legitimate large 3.0; see RECHARGE_AC_CONTRAST chains').toEqual([]);
}

// Run this one helper calibration separately before the 36 product cases.
// All literal expectations below are independent of acRechargeContrast.
describe('recharge ac contrast calibration', () => {
  it('recharge ac contrast calibration browser-srgb-8bit', async () => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'ready' }, async s => {
      const hostId = 'recharge-ac-contrast-calibration-probes';
      expect(await s.page.locator('#' + hostId).count()).toBe(0);
      try {
        await s.page.evaluate(id => {
          const host = document.createElement('div'); host.id = id;
          Object.assign(host.style, { position: 'fixed', top: '12px', left: '12px', width: '300px', padding: '8px', zIndex: '2147483647', backgroundColor: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)', fontFamily: 'sans-serif' });
          // Only this dedicated test subtree is created or styled. Append first
          // so the finally block can also remove a partially constructed host.
          document.body.appendChild(host);
          const probes: Array<{ id: string; color: string; background: string; size: string; weight: string; image?: string }> = [
            { id: 'opaque', color: 'rgb(255, 255, 255)', background: 'rgb(0, 0, 0)', size: '14px', weight: '400' },
            { id: 'white-half', color: 'color-mix(in oklab, rgb(255,255,255) 50%, transparent)', background: 'rgb(0, 0, 0)', size: '14px', weight: '400' },
            { id: 'observed-white-half', color: 'oklab(0.999994 0.0000455678 0.0000200868 / 0.5)', background: 'rgb(0, 0, 0)', size: '14px', weight: '400' },
            { id: 'background-half', color: 'rgb(0, 0, 0)', background: 'color-mix(in oklab, rgb(255,255,255) 50%, transparent)', size: '14px', weight: '400' },
            { id: 'gradient', color: 'rgb(255, 255, 255)', background: 'rgb(0, 0, 0)', size: '14px', weight: '400', image: 'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))' },
            { id: 'large-regular', color: 'rgb(255, 255, 255)', background: 'rgb(0, 0, 0)', size: '24px', weight: '400' },
            { id: 'large-bold', color: 'rgb(255, 255, 255)', background: 'rgb(0, 0, 0)', size: '20px', weight: '700' },
            { id: 'normal-bold', color: 'rgb(255, 255, 255)', background: 'rgb(0, 0, 0)', size: '18px', weight: '700' },
          ];
          for (const definition of probes) {
            const parent = document.createElement('div'); parent.dataset.acProbeParent = definition.id;
            parent.style.backgroundColor = definition.background;
            parent.style.backgroundImage = definition.image ?? 'none';
            const probe = document.createElement('p'); probe.dataset.acProbe = definition.id;
            Object.assign(probe.style, { margin: '0', padding: '4px', color: definition.color, fontSize: definition.size, fontWeight: definition.weight, lineHeight: '32px' });
            probe.textContent = 'Calibration ' + definition.id;
            parent.appendChild(probe); host.appendChild(parent);
          }
        }, hostId);
        await frames(s.page);
        const samples: Record<string, AcRechargeContrastSample> = {};
        for (const id of ['opaque', 'white-half', 'observed-white-half', 'background-half', 'gradient', 'large-regular', 'large-bold', 'normal-bold']) {
          const probe = s.page.locator('#' + hostId + ' [data-ac-probe="' + id + '"]');
          expect(await probe.count()).toBe(1);
          expect(await readable(probe), 'recharge ac contrast calibration visible probe: ' + id).toBe(true);
          samples[id] = await acRechargeContrast(probe);
          console.log('RECHARGE_AC_CONTRAST_CALIBRATION', JSON.stringify({ probe: id, ...samples[id] }));
        }
        for (const id of ['opaque', 'white-half', 'observed-white-half', 'background-half', 'large-regular', 'large-bold', 'normal-bold']) expect(samples[id].issues, id + ' must be verified before interpreting its ratio').toEqual([]);
        expect(samples.opaque.ratio).toBe(21);
        expect(samples.opaque.requiredRatio).toBe(4.5);
        expect(samples.opaque.conversionMethod).toBe('exact-srgb');
        // RGBA8 white alpha is 128/255, so over black it is RGB(128,128,128).
        // Hand-specified contrast vs black: 5.31721, checked to four decimals.
        for (const id of ['white-half', 'observed-white-half']) {
          const sample = samples[id];
          expect(sample.conversionMethod).toBe('browser-srgb-8bit');
          expect(sample.colorConversions.find(conversion => conversion.source === 'target.color')?.bytes).toEqual([255, 255, 255, 128]);
          expect(sample.ratio).toBeCloseTo(5.31721, 4);
          expect(sample.requiredRatio).toBe(4.5);
        }
        const background = samples['background-half'];
        expect(background.conversionMethod).toBe('browser-srgb-8bit');
        expect(background.colorConversions.find(conversion => conversion.source !== 'target.color' && conversion.method === 'browser-srgb-8bit')?.bytes).toEqual([255, 255, 255, 128]);
        expect(background.background).toEqual([128 / 255, 128 / 255, 128 / 255, 1]);
        expect(background.paintedText).toEqual([0, 0, 0, 1]);
        expect(background.ratio).toBeCloseTo(5.31721, 4);
        expect(background.requiredRatio).toBe(4.5);
        expect(samples.gradient.issues.some(issue => issue.includes('AC_UNHANDLED_BACKGROUND_IMAGE'))).toBe(true);
        expect(samples.gradient.ratio, 'unsupported gradient must remain UNVERIFIED').toBeNull();
        expect(samples.gradient.paintedText).toBeNull();
        for (const id of ['large-regular', 'large-bold']) {
          expect(samples[id].requiredRatio).toBe(3.0);
          expect(samples[id].ratio).toBe(21);
        }
        expect(samples['normal-bold'].requiredRatio).toBe(4.5);
        expect(samples['normal-bold'].ratio).toBe(21);
      } finally {
        await s.page.evaluate(id => { document.getElementById(id)?.remove(); }, hostId);
      }
      expect(await s.page.locator('#' + hostId).count(), 'recharge ac contrast calibration removes only its test subtree').toBe(0);
      expect([...s.counts.keys()].sort(), 'recharge ac contrast calibration exact original read-only fixture HTTP').toEqual(['GET /', 'GET /api/recharge/w-order']);
      expect(s.blockedWs).toEqual([]); expect(s.faults).toEqual([]);
    });
  }, 25000);
});

describe('recharge ac contrast native text', () => {
  // Five original fixture states, six existing theme/window combinations = 30 cases.
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[320, 640], [390, 844], [640, 320]] as const) for (const variant of ['ready', 'returned', 'paid-zero', 'submitted', 'expired'] as const) {
    it('recharge ac contrast ' + theme + ' ' + width + 'x' + height + ' ' + variant, async () => {
      await withPage(theme, width, height, { surface: 'recharge', variant }, async s => {
        expect(await s.page.locator('html').getAttribute('data-theme')).toBe(theme === 'mono' ? 'light' : 'dark');
        const text = (value: string | RegExp): Locator => s.page.getByText(value, { exact: true });
        const targets: AcRechargeContrastTarget[] = [];
        if (variant === 'ready' || variant === 'returned') {
          await s.page.getByRole('heading', { name: '无界AI 积分充值', exact: true }).waitFor();
          // QR generation is real. Its visible helper text must actually exist.
          await s.page.getByAltText('支付二维码', { exact: true }).waitFor();
          targets.push(
            { name: '充值金额', locator: text('充值金额') },
            { name: '获得积分', locator: text('获得积分') },
            { name: '支付方式说明', locator: text('使用微信支付') },
          );
          if (variant === 'ready') targets.push(
            { name: '可用支付主CTA', locator: s.page.getByRole('link', { name: '立即支付 ¥12.00', exact: true }), action: true },
            { name: '初次支付二维码说明', locator: text('点击按钮未打开微信？长按下方二维码保存，打开微信扫一扫 → 相册选图') },
            { name: '打开支付提示', locator: text('点击后将打开微信支付完成付款') },
          );
          else targets.push(
            { name: '可用重新支付CTA', locator: s.page.getByRole('link', { name: '重新支付 ¥12.00', exact: true }), action: true },
            { name: '可用付款通知CTA', locator: s.page.getByRole('button', { name: '我已完成付款', exact: true }), action: true },
            { name: '审核与重复提交说明', locator: s.page.locator('p').filter({ hasText: /^⚠️ 点击后将通知管理员审核，确认收款后积分会自动到账。\s*请勿重复提交，恶意刷单将被封禁账号。$/ }) },
            { name: '返回支付二维码说明', locator: text('如未完成支付，长按二维码保存，微信扫一扫 → 相册') },
            { name: '付款通知操作说明', locator: text('付款完成后点击“我已完成付款”，管理员审核通过后积分将到账') },
          );
          targets.push(
            { name: '订单备注', locator: text('💡 本地合成订单，不可支付_' + LONG) },
            { name: '页脚订单号', locator: text('订单号：w-order...') },
            { name: '页脚有效期', locator: text(/^有效期至：.+$/) },
          );
          // Header subtitle “扫码转账，审核到账” is deliberately not targeted:
          // its gradient needs spatial evidence, not a solid-background ratio.
        } else if (variant === 'paid-zero') {
          await s.page.getByRole('heading', { name: '充值成功！', exact: true }).waitFor();
          targets.push(
            { name: '到账说明', locator: text('已审核通过并到账，可在无界AI工作台查看余额') },
            { name: '已到账余额标签', locator: text('当前余额') },
            { name: '关闭页面提示', locator: text('您可以关闭此页面') },
          );
        } else if (variant === 'submitted') {
          await s.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor();
          targets.push(
            { name: '审核时效与保持页面说明', locator: s.page.locator('p').filter({ hasText: /^您的付款通知已提交，管理员将在确认收款后为您充值积分，通常1-10分钟内处理完成。\s*请保持此页面打开，到账后将自动提示。$/ }) },
            { name: '审核订单金额标签', locator: text('订单金额') },
            { name: '审核到账积分标签', locator: text('到账积分') },
            { name: '审核支付方式标签', locator: text('支付方式') },
            { name: '可用刷新状态', locator: s.page.getByRole('button', { name: '刷新状态', exact: true }), action: true },
            { name: '客服帮助', locator: text('如有问题请联系客服处理') },
          );
        } else {
          await s.page.getByRole('heading', { name: '订单已过期', exact: true }).waitFor();
          targets.push(
            { name: '过期重新充值说明', locator: text('该充值订单已超时，请返回无界AI重新发起充值') },
            { name: '过期时间提示', locator: text(/^过期时间：.+$/) },
          );
        }
        await acRunRechargeContrastTargets(s, { theme, width, height, variant }, targets);
      });
    }, 25000); // Original per-case budget; default locator timeout stays 1800ms.
  }
});

// Six direct-adjacency cases for the payment CTA class shared with WeChat.
// Uses the original AB response, QR encoder and exact original HTTP rules.
describe('recharge ac contrast alipay adjacent native text', () => {
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[320, 640], [390, 844], [640, 320]] as const) {
    it('recharge ac contrast ' + theme + ' ' + width + 'x' + height + ' ab-qr-alipay-custom', async () => {
      await withPage(theme, width, height, { surface: 'recharge', variant: 'ab-qr-alipay-custom' }, async s => {
        expect(await s.page.locator('html').getAttribute('data-theme')).toBe(theme === 'mono' ? 'light' : 'dark');
        await s.page.getByRole('heading', { name: '无界AI 积分充值', exact: true }).waitFor();
        await s.page.getByAltText('支付二维码', { exact: true }).waitFor();
        const text = (value: string | RegExp): Locator => s.page.getByText(value, { exact: true });
        const targets: AcRechargeContrastTarget[] = [
          { name: '充值金额', locator: text('充值金额') },
          { name: '获得积分', locator: text('获得积分') },
          { name: '支付宝支付方式说明', locator: text('使用支付宝支付') },
          { name: '自定义1337积分标签', locator: text('自定义 1337 积分') },
          { name: '可用支付宝支付主CTA', locator: s.page.getByRole('link', { name: '立即支付 ¥13.37', exact: true }), action: true },
          { name: '支付宝二维码说明', locator: text('点击按钮未打开支付宝？长按下方二维码保存，打开支付宝扫一扫 → 相册选图') },
          { name: '打开支付宝提示', locator: text('点击后将打开支付宝完成付款') },
          { name: 'AB原订单备注', locator: text('💡 合成甲订单说明') },
          { name: '页脚订单号', locator: text('订单号：w-order...') },
          { name: '页脚有效期', locator: text(/^有效期至：.+$/) },
        ];
        expect(await s.page.locator('span').filter({ hasText: /^\+\d+赠$/ }).count(), 'recharge ac contrast alipay custom fixture has no bonus').toBe(0);
        expect(await s.page.getByRole('button', { name: '我已完成付款', exact: true }).count(), 'recharge ac contrast alipay fixture is pending, not returned').toBe(0);
        await acRunRechargeContrastTargets(s, { theme, width, height, variant: 'ab-qr-alipay-custom' }, targets);
      });
    }, 25000);
  }
});

// AD draft: append after the frozen AC helpers. No imports or existing edits.
// Only one simple linear-gradient ancestor is supported. A replica is not a
// screenshot of production glyphs or a universal/source-gamut WCAG certificate.
type AdHeaderRgba = [number, number, number, number];
interface AdHeaderGeometry {
  index: number;
  rect: { x: number; y: number; width: number; height: number };
  css: Record<string, string>;
  glyphs: Array<{ x: number; y: number; width: number; height: number }>;
}
interface AdHeaderSample {
  method: 'native-chromium-replica-full-rectangle-srgb-8bit';
  ac: AcRechargeContrastSample | null;
  geometry: AdHeaderGeometry | null;
  foreground: AdHeaderRgba | null;
  backing: AdHeaderRgba | null;
  pngSha256: string | null;
  dimensions: { width: number; height: number } | null;
  pixelCount: number;
  distinctBackgroundColors: number;
  minRatio: number | null;
  maxRatio: number | null;
  probeCreated: boolean;
  cleanupAttempted: boolean;
  probeRemoved: boolean;
  issues: string[];
}

async function adHeaderGeometry(control: Locator, ac: AcRechargeContrastSample): Promise<AdHeaderGeometry> {
  return await control.evaluate((element, expected): AdHeaderGeometry => {
    const nodes: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) nodes.unshift(node);
    const images = nodes.map((node, index) => ({ node, index, image: getComputedStyle(node).backgroundImage })).filter(item => item.image !== 'none');
    if (images.length !== 1 || !images[0].image.startsWith('linear-gradient(') || (images[0].image.match(/gradient\(/g) ?? []).length !== 1 || /url\(/i.test(images[0].image)) throw Error('AD_UNVERIFIED_SINGLE_LINEAR_HEADER_REQUIRED');
    const { node: gradient, index } = images[0], style = getComputedStyle(gradient), box = gradient.getBoundingClientRect();
    if (nodes.length !== expected.chain.length || expected.chain[index]?.image !== images[0].image) throw Error('AD_UNVERIFIED_CHANGED_SOURCE_CHAIN');
    const own = getComputedStyle(element);
    if (own.color !== expected.foreground || own.fontSize !== expected.fontSize || own.fontWeight !== expected.fontWeight) throw Error('AD_UNVERIFIED_CHANGED_TEXT_STYLE');
    if (devicePixelRatio !== 1 || scrollX !== 0 || scrollY !== 0 || !Number.isInteger(box.width) || !Number.isInteger(box.height) || box.width <= 0 || box.height <= 0 || box.width > innerWidth || box.height > innerHeight) throw Error('AD_UNVERIFIED_CAPTURE_GEOMETRY');
    if (style.boxSizing !== 'border-box' || style.backgroundAttachment !== 'scroll') throw Error('AD_UNVERIFIED_BACKGROUND_COORDINATES');
    const properties = ['background-color', 'background-image', 'background-position', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment', 'background-blend-mode', 'box-sizing'];
    for (const side of ['top', 'right', 'bottom', 'left']) properties.push('padding-' + side, 'border-' + side + '-width', 'border-' + side + '-style', 'border-' + side + '-color');
    for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) properties.push('border-' + corner + '-radius');
    const css: Record<string, string> = {};
    for (const property of properties) css[property] = style.getPropertyValue(property);
    const glyphs: AdHeaderGeometry['glyphs'] = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) glyphs.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    if (!glyphs.length || glyphs.some(rect => rect.x < box.left || rect.y < box.top || rect.x + rect.width > box.right || rect.y + rect.height > box.bottom)) throw Error('AD_UNVERIFIED_TEXT_OUTSIDE_HEADER');
    for (const node of nodes) {
      const current = getComputedStyle(node), bounds = node.getBoundingClientRect();
      if (current.transform !== 'none' || current.perspective !== 'none' || current.clipPath !== 'none' || !['', '1', 'normal'].includes(current.getPropertyValue('zoom')) || node.getAnimations().some(animation => animation.playState === 'running' || animation.pending)) throw Error('AD_UNVERIFIED_TRANSFORM_CLIP_OR_ANIMATION');
      // The real card clips rounded corners. Require glyphs in its rectangular
      // interior, so omitting that outer corner clipping cannot hide text paint.
      if (/auto|scroll|hidden|clip/.test(current.overflowX + current.overflowY)) {
        const radii = [current.borderTopLeftRadius, current.borderTopRightRadius, current.borderBottomRightRadius, current.borderBottomLeftRadius];
        if (radii.some(radius => !/^\d+(?:\.\d+)?px$/.test(radius))) throw Error('AD_UNVERIFIED_COMPLEX_CORNER');
        const inset = Math.max(...radii.map(radius => Number.parseFloat(radius)));
        if (inset > 0 && glyphs.some(rect => rect.x < bounds.left + inset || rect.y < bounds.top + inset || rect.x + rect.width > bounds.right - inset || rect.y + rect.height > bounds.bottom - inset)) throw Error('AD_UNVERIFIED_ROUNDED_CLIP_FOOTPRINT');
      }
    }
    return { index, rect: { x: box.x, y: box.y, width: box.width, height: box.height }, css, glyphs };
  }, ac);
}

async function adHeaderContrast(s: Session, control: Locator): Promise<AdHeaderSample> {
  const id = 'recharge-ad-background-probe';
  const result: AdHeaderSample = { method: 'native-chromium-replica-full-rectangle-srgb-8bit', ac: null, geometry: null, foreground: null, backing: null, pngSha256: null, dimensions: null, pixelCount: 0, distinctBackgroundColors: 0, minRatio: null, maxRatio: null, probeCreated: false, cleanupAttempted: false, probeRemoved: false, issues: [] };
  let reserved = false;
  try {
    if (await s.page.locator('#' + id).count() !== 0) throw Error('AD_UNVERIFIED_PROBE_ID_ALREADY_OWNED');
    reserved = true;
    const ac = await acRechargeContrast(control); result.ac = ac;
    const geometry = await adHeaderGeometry(control, ac); result.geometry = geometry;
    const layer = ac.chain[geometry.index];
    const gradientIssue = layer.node + ': AC_UNHANDLED_BACKGROUND_IMAGE ' + layer.image;
    // Preserve every AC unsupported check. Replace exactly this one rejection
    // only after bounding the actual single gradient; retain it in nested ac.
    if (ac.issues.length !== 1 || ac.issues[0] !== gradientIssue) throw Error('AD_UNVERIFIED_OTHER_AC_PAINT ' + JSON.stringify(ac.issues));
    // The current header and all wrappers below it have transparent solid fills.
    // Therefore AC's root->leaf solid composite is exactly the backing BEHIND it.
    if (ac.chain.slice(geometry.index).some(item => !item.rgba || item.rgba[3] !== 0) || ac.background[3] !== 1) throw Error('AD_UNVERIFIED_SOLID_BACKING_BOUND');
    const foreground = ac.colorConversions.find(conversion => conversion.source === 'target.color')?.rgba;
    if (!foreground || foreground.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)) throw Error('AD_UNVERIFIED_FOREGROUND');
    result.foreground = foreground; result.backing = ac.background;
    await s.page.evaluate(({ probeId, source, backing }) => {
      if (document.getElementById(probeId)) throw Error('AD_UNVERIFIED_PROBE_COLLISION');
      const host = document.createElement('div'); host.id = probeId;
      Object.assign(host.style, { position: 'fixed', left: '0px', top: '0px', width: source.rect.width + 'px', height: source.rect.height + 'px', margin: '0', padding: '0', border: '0', overflow: 'hidden', zIndex: '2147483647', pointerEvents: 'none', backgroundColor: 'rgba(' + backing.slice(0, 3).map(channel => channel * 255).join(',') + ',' + backing[3] + ')' });
      document.body.appendChild(host); // finally owns even a partial construction.
      const paint = document.createElement('div');
      Object.assign(paint.style, { display: 'block', width: '100%', height: '100%', margin: '0' });
      for (const [property, value] of Object.entries(source.css)) paint.style.setProperty(property, value);
      host.appendChild(paint);
      const box = paint.getBoundingClientRect(), actual = getComputedStyle(paint);
      if (box.x !== 0 || box.y !== 0 || box.width !== source.rect.width || box.height !== source.rect.height) throw Error('AD_UNVERIFIED_REPLICA_DIMENSIONS');
      for (const [property, value] of Object.entries(source.css)) if (actual.getPropertyValue(property) !== value) throw Error('AD_UNVERIFIED_REPLICA_CSS ' + property);
      if (host.textContent !== '') throw Error('AD_UNVERIFIED_REPLICA_CONTAINS_TEXT');
    }, { probeId: id, source: geometry, backing: ac.background });
    result.probeCreated = true;
    await frames(s.page);
    // In-memory PNG only; CSS-pixel capture and opaque backing, no white matte.
    const png = await s.page.screenshot({ type: 'png', scale: 'css', omitBackground: true, clip: { x: 0, y: 0, width: geometry.rect.width, height: geometry.rect.height } });
    const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
    const sharp = require('sharp') as typeof import('sharp').default;
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    result.pngSha256 = createHash('sha256').update(png).digest('hex');
    const metadata = await sharp(png).metadata();
    if (metadata.format !== 'png' || metadata.space !== 'srgb' || metadata.depth !== 'uchar' || metadata.width !== geometry.rect.width || metadata.height !== geometry.rect.height) throw Error('AD_UNVERIFIED_PNG_FORMAT_OR_DIMENSIONS');
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width !== geometry.rect.width || info.height !== geometry.rect.height || data.length !== info.width * info.height * 4) throw Error('AD_UNVERIFIED_RAW_DIMENSIONS');
    result.dimensions = { width: info.width, height: info.height }; result.pixelCount = info.width * info.height;
    const luminance = (r: number, g: number, b: number): number => [r, g, b].map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const colors = new Set<number>(); let minimum = Infinity, maximum = -Infinity;
    for (let pixel = 0; pixel < data.length; pixel += 4) {
      if (data[pixel + 3] !== 255) throw Error('AD_UNVERIFIED_NONOPAQUE_PIXEL');
      colors.add((data[pixel] << 16) | (data[pixel + 1] << 8) | data[pixel + 2]);
      const back = [data[pixel] / 255, data[pixel + 1] / 255, data[pixel + 2] / 255];
      const painted = back.map((channel, index) => foreground[index] * foreground[3] + channel * (1 - foreground[3]));
      const a = luminance(painted[0], painted[1], painted[2]), b = luminance(back[0], back[1], back[2]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      minimum = Math.min(minimum, ratio); maximum = Math.max(maximum, ratio);
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) throw Error('AD_UNVERIFIED_EMPTY_OR_NONFINITE_RASTER');
    result.distinctBackgroundColors = colors.size; result.minRatio = minimum; result.maxRatio = maximum;
  } catch (error) { result.issues.push('AD_UNVERIFIED ' + String(error)); }
  finally {
    if (reserved) {
      result.cleanupAttempted = true;
      try {
        const cleanup = await s.page.evaluate(probeId => { const host = document.getElementById(probeId), found = !!host; host?.remove(); return { found, absent: document.getElementById(probeId) === null }; }, id);
        result.probeCreated = result.probeCreated || cleanup.found; result.probeRemoved = cleanup.absent;
        if (!cleanup.absent) throw Error('AD_UNVERIFIED_PROBE_REMAINS');
        if (result.ac && result.geometry) {
          const current = await adHeaderGeometry(control, result.ac);
          if (JSON.stringify(current) !== JSON.stringify(result.geometry) || !await readable(control)) throw Error('AD_UNVERIFIED_SOURCE_CHANGED_OR_UNREADABLE');
        }
      } catch (error) { result.issues.push('AD_UNVERIFIED_CLEANUP_OR_STABILITY ' + String(error)); }
    }
    if (result.issues.length) { result.minRatio = null; result.maxRatio = null; }
  }
  return result;
}

function adHeaderVerified(sample: AdHeaderSample): void {
  expect(sample.issues, 'recharge ad header UNVERIFIED evidence is invalid RED').toEqual([]);
  expect(sample.probeCreated, 'recharge ad header native replica must exist').toBe(true);
  expect(sample.cleanupAttempted && sample.probeRemoved, 'recharge ad header cleanup required before product assertion').toBe(true);
  expect(sample.pixelCount, 'recharge ad header native pixel evidence').toBeGreaterThan(0);
  if (!sample.ac || sample.minRatio === null || sample.maxRatio === null || !Number.isFinite(sample.minRatio) || !Number.isFinite(sample.maxRatio) || sample.maxRatio < sample.minRatio) throw Error('AD_UNVERIFIED_NO_RENDERED_RATIO');
}

describe('recharge ad header', () => {
  it('calibration native replica and unsupported paint', async () => {
    await withPage('gold', 390, 844, { surface: 'recharge', variant: 'ready' }, async s => {
      const id = 'recharge-ad-calibration-source';
      expect(await s.page.locator('#' + id).count()).toBe(0);
      try {
        await s.page.evaluate(sourceId => {
          const host = document.createElement('div'); host.id = sourceId;
          Object.assign(host.style, { position: 'fixed', left: '12px', top: '12px', width: '256px', backgroundColor: 'rgb(0,0,0)', zIndex: '2147483646' });
          document.body.appendChild(host);
          for (const [name, image, color] of [
            ['opaque', 'linear-gradient(to right, rgb(0,0,0), rgb(0,0,0))', 'rgb(255,255,255)'],
            ['gray', 'linear-gradient(to right, rgb(128,128,128), rgb(128,128,128))', 'rgb(0,0,0)'],
            ['varying', 'linear-gradient(to right, rgb(0,0,0), rgb(255,255,255))', 'rgb(255,255,255)'],
            ['image', 'radial-gradient(rgb(0,0,0), rgb(255,255,255))', 'rgb(255,255,255)'],
            ['mask', 'linear-gradient(to right, rgb(0,0,0), rgb(255,255,255))', 'rgb(255,255,255)'],
            ['opacity', 'linear-gradient(to right, rgb(0,0,0), rgb(255,255,255))', 'rgb(255,255,255)'],
          ]) {
            const parent = document.createElement('div');
            Object.assign(parent.style, { boxSizing: 'border-box', width: '256px', height: '32px', backgroundImage: image, backgroundColor: 'transparent' });
            const text = document.createElement('p'); text.dataset.adCalibration = name; text.textContent = 'Calibration ' + name;
            Object.assign(text.style, { margin: '0', color, fontSize: '14px', fontWeight: '400', lineHeight: '24px' });
            if (name === 'mask') text.style.maskImage = 'linear-gradient(rgb(0,0,0), rgb(0,0,0))';
            if (name === 'opacity') text.style.opacity = '0.5';
            parent.appendChild(text); host.appendChild(parent);
          }
        }, id);
        await frames(s.page);
        const samples: Record<string, AdHeaderSample> = {};
        for (const name of ['opaque', 'gray', 'varying', 'image', 'mask', 'opacity']) {
          const target = s.page.locator('#' + id + ' [data-ad-calibration="' + name + '"]');
          expect(await target.count()).toBe(1); expect(await readable(target)).toBe(true);
          samples[name] = await adHeaderContrast(s, target);
          console.log('RECHARGE_AD_HEADER_CALIBRATION', JSON.stringify({ name, ...samples[name] }));
        }
        for (const name of ['opaque', 'gray', 'varying']) adHeaderVerified(samples[name]);
        expect(samples.opaque.minRatio).toBe(21);
        expect(samples.gray.minRatio).toBeCloseTo(5.31721, 4); // Independent RGB128/black literal; product threshold has NO tolerance.
        expect(samples.opaque.maxRatio).toBe(21);
        expect(samples.gray.maxRatio).toBeCloseTo(5.31721, 4); // Same independent constant-background literal, not derived from MIN.
        expect(samples.opaque.distinctBackgroundColors).toBe(1);
        expect(samples.gray.distinctBackgroundColors).toBe(1);
        expect(samples.varying.distinctBackgroundColors, 'native gradient must contain actual differing pixels').toBeGreaterThan(1);
        expect(samples.varying.maxRatio).toBeGreaterThan(samples.varying.minRatio!);
        for (const name of ['image', 'mask', 'opacity']) {
          expect(samples[name].issues.length, 'unsupported paint stays explicit UNVERIFIED').toBeGreaterThan(0);
          expect(samples[name].minRatio).toBeNull(); expect(samples[name].maxRatio).toBeNull(); expect(samples[name].probeRemoved).toBe(true);
        }
        expect(samples.mask.ac?.issues.some(issue => issue.includes('AC_UNHANDLED_MASK'))).toBe(true);
        expect(samples.opacity.ac?.issues.some(issue => issue.includes('AC_UNHANDLED_GROUP_OPACITY'))).toBe(true);
      } finally {
        await s.page.evaluate(sourceId => { document.getElementById(sourceId)?.remove(); }, id);
      }
      expect(await s.page.locator('#' + id).count()).toBe(0);
      expect([...s.counts.keys()].sort()).toEqual(['GET /', 'GET /api/recharge/w-order']);
      expect(s.blockedWs).toEqual([]); expect(s.faults).toEqual([]);
    });
  }, 25000);
  for (const theme of ['gold', 'mono'] as const) for (const [width, height] of [[320, 640], [390, 844], [640, 320]] as const) for (const variant of ['ready', 'ab-qr-alipay-custom'] as const) {
    it(theme + ' ' + width + 'x' + height + ' ' + variant, async () => {
      const failures: Array<{ target: string; ratio: number; required: number }> = [];
      await withPage(theme, width, height, { surface: 'recharge', variant }, async s => {
        expect(await s.page.locator('html').getAttribute('data-theme')).toBe(theme === 'mono' ? 'light' : 'dark');
        await s.page.getByAltText('支付二维码', { exact: true }).waitFor();
        const targets = [
          { name: 'title', locator: s.page.getByRole('heading', { name: '无界AI 积分充值', exact: true }) },
          { name: 'subtitle', locator: s.page.getByText('扫码转账，审核到账', { exact: true }) },
        ];
        for (const target of targets) {
          expect(await target.locator.count()).toBe(1);
          expect(await reveal(s, target.locator), 'recharge ad header original real-wheel reachability').toBe(true);
          await s.page.mouse.move(0, 0); await frames(s.page);
          expect(await readable(target.locator), 'recharge ad header original readable predicate').toBe(true);
          const sample = await adHeaderContrast(s, target.locator);
          // Full-rectangle MIN proves PASS, but cannot alone prove text FAIL.
          // Retain both measured bounds on ambiguous evidence for diagnostics;
          // the UNVERIFIED gate below prevents the final product classifier tag.
          if (sample.ac && sample.minRatio !== null && sample.maxRatio !== null && sample.minRatio < sample.ac.requiredRatio && sample.maxRatio >= sample.ac.requiredRatio) {
            sample.issues.push('AD_UNVERIFIED_TEXT_FOOTPRINT_INTERVAL min=' + sample.minRatio + ' required=' + sample.ac.requiredRatio + ' max=' + sample.maxRatio);
          }
          console.log('RECHARGE_AD_HEADER_CONTRAST', JSON.stringify({ theme, width, height, variant, target: target.name, ...sample }));
          adHeaderVerified(sample);
          if (!sample.ac || sample.minRatio === null || sample.maxRatio === null) throw Error('AD_UNVERIFIED_PRODUCT_SAMPLE');
          // The original MIN assertion is retained; after qualification it can
          // fail only when MAX < required, so every possible backdrop fails.
          if (sample.minRatio < sample.ac.requiredRatio) failures.push({ target: target.name, ratio: sample.minRatio, required: sample.ac.requiredRatio });
        }
        expect([...s.counts.keys()].sort()).toEqual(['GET /', 'GET /api/recharge/w-order']);
        expect(s.blockedWs).toEqual([]); expect(s.faults).toEqual([]);
      });
      // withPage has also completed fixture disposal before this classifier tag.
      expect(failures, 'rendered gradient text must meet normal 4.5 / legitimate large 3.0').toEqual([]);
    }, 25000);
  }
});


// Same-evaluation AA failure showed zero ancestor opacity and a 95% scale.
// Prove the actual reduced-motion CSS contract without racing a transient frame.
describe('aa motion preference', () => {
  for (const theme of ['gold', 'mono'] as const) for (const motion of ['reduce', 'no-preference'] as const) {
    it(theme + ' ' + motion + ' keeps the requested preview animation policy', async () => {
      await withPage(theme, 390, 844, { surface: 'canvas-share', variant: 'aa-media-preview' }, async s => {
        await s.page.emulateMedia({ reducedMotion: motion });
        await s.page.getByRole('button', { name: '预览合成海报', exact: true }).click();
        const preview = s.page.getByRole('dialog', { name: '媒体预览' });
        await preview.waitFor();
        const observed = await preview.evaluate(element => {
          const style = getComputedStyle(element);
          return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, state: element.getAttribute('data-state'), animationName: style.animationName, animationDuration: style.animationDuration, opacity: style.opacity, transform: style.transform, animations: element.getAnimations().map(animation => ({ name: animation instanceof CSSAnimation ? animation.animationName : null, state: animation.playState })) };
        });
        console.log('AA_MOTION_POLICY', JSON.stringify({ theme, motion, observed }));
        expect(observed.reduced, 'native browser must use the explicitly requested motion preference').toBe(motion === 'reduce');
        expect(observed.state).toBe('open');
        if (motion === 'reduce') {
          expect(observed.animationName, 'reduced motion preview must disable the inherited opening animation').toBe('none');
          await aaUsable(s.page.getByRole('button', { name: '关闭预览', exact: true }));
        } else expect(observed.animationName, 'ordinary preference keeps the existing opening animation').not.toBe('none');
        await s.page.getByRole('button', { name: '关闭预览', exact: true }).click();
        await preview.waitFor({ state: 'hidden' });
      });
    }, 25000);
  }
});
