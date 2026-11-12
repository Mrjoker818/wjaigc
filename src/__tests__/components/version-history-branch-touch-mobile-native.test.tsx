// @vitest-environment node
// Retains the qualified history-branch touch regression with real production CSS.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium, type Browser, type BrowserContext, type Page, type Locator, type Request} from '@playwright/test';
import {beforeAll, afterAll, it} from 'vitest';
import {createOwnedOperations, acquireOwned} from '../../../tests/helpers/native-owned-operations';

const ORIGIN = 'https://history-branch-mobile.invalid';
const SHOTS = path.resolve('output/playwright/version-history-branch-touch-mobile-native', String(process.pid));
const operations = createOwnedOperations();
const live = new Set<BrowserContext>();
const closingContexts = new Map<BrowserContext, Promise<void>>();
let browser: Browser | undefined, bundle = '', css = '', closing = false;
let browserClose: Promise<void> | undefined, browserDisconnected = false;
let ownsShots = false;

interface HistoryEvent {type: string; trusted: boolean; pointer: string}
interface HistorySnapshot {restore: number; create: number; close: number; errors: string[]; events: HistoryEvent[]; tree: string; storage: string}
interface DeviceMetrics {width: number; height: number; touch: number; coarse: boolean; hover: boolean}
interface ControlMetrics {
  label: string; name: string | null; width: number; height: number; opacity: number; clear: boolean;
  rect: {x: number; y: number; width: number; height: number}; hits: boolean[];
}
interface RequestRecord {url: string; method: string; terminal: 'finished' | null}
interface CaseResult {
  theme: string; metrics: ControlMetrics[]; bodyComplete: boolean; closed: boolean;
  requests: RequestRecord[]; faults: string[]; device?: DeviceMetrics;
  before?: HistorySnapshot; after?: HistorySnapshot; defects?: string[];
}
const cases: CaseResult[] = [];
declare global {
  interface Window {
    pb: {show: (theme: string) => void; unmount: () => void; snapshot: () => HistorySnapshot};
  }
}

const ENTRY = String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import {VersionHistoryPanel} from '@/components/version-history-panel';
import {TreeHistoryManager} from '@/lib/canvas-tree-history';
const manager=new TreeHistoryManager();manager.initializeRoot([],'PB 原始版本');manager.recordOperation([],'PB 后续版本','update');
const root=createRoot(document.getElementById('fixture-root')!);
const state={restore:0,create:0,close:0,errors:[] as string[],events:[] as Array<{type:string;trusted:boolean;pointer:string}>};
for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,e=>state.events.push({type,trusted:e.isTrusted,pointer:e instanceof PointerEvent?e.pointerType:''}),{passive:true});
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}componentDidCatch(e:Error){state.errors.push(e.message);}render(){return this.state.failed?null:this.props.children;}}
const show=(theme:string)=>{document.documentElement.classList.toggle('dark',theme==='gold');document.documentElement.classList.toggle('theme-monochrome',theme==='mono');root.render(<Boundary><VersionHistoryPanel manager={manager} position="bottom" rightInset={0} isMonochrome={theme==='mono'} onRestore={()=>{state.restore++;throw Error('PB_RESTORE_FORBIDDEN');}} onCreateBranch={()=>{state.create++;throw Error('PB_CREATE_FORBIDDEN');}} onClose={()=>{state.close++;root.render(null);}}/></Boundary>);};
Object.assign(window,{pb:{show,unmount:()=>root.unmount(),snapshot:()=>({...state,tree:JSON.stringify(manager.exportData()),storage:JSON.stringify({...localStorage})})}});
`;

function run<T>(name: string, operation: () => Promise<T>, ms = 2500): Promise<T> {
  return operations.run('PB-' + name, operation, ms);
}
function closeContext(context: BrowserContext): Promise<void> {
  let pending = closingContexts.get(context);
  if (!pending) {pending = context.close(); closingContexts.set(context, pending);}
  return pending;
}
function closeBrowser(value: Browser): Promise<void> {
  browserClose ??= value.close();
  return browserClose;
}

beforeAll(async (): Promise<void> => {
  assert.equal(fs.existsSync(SHOTS), false);
  fs.mkdirSync(path.dirname(SHOTS), {recursive: true});
  fs.mkdirSync(SHOTS);
  ownsShots = true;
  await run('compile', async (): Promise<void> => {
    const output = await build({write: false, metafile: true, bundle: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', stdin: {contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'pb-history-branch-entry.tsx'}});
    assert.equal(output.outputFiles.length, 1);
    assert.ok(output.metafile);
    bundle = output.outputFiles[0].text;
    const files = Object.keys(output.metafile.inputs).filter(f => /^src[\\/]/.test(f) && /\.[jt]sx?$/.test(f));
    assert.deepEqual(files.sort(), ['src/components/version-history-panel.tsx', 'src/lib/canvas-tree-history.ts']);
    const require = createRequire(import.meta.url);
    const compiler = await compile(fs.readFileSync('src/app/globals.css', 'utf8'), {base: process.cwd(), loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return {path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8')};
    }});
    css = compiler.build(new Scanner({}).scanFiles(files.map(f => ({content: fs.readFileSync(f, 'utf8'), extension: path.extname(f).slice(1)}))));
  }, 30000);
  if (closing) throw Error('PB2_STARTUP_CLOSED');
  browser = await acquireOwned(operations, 'PB-launch', async (): Promise<Browser> => {
    if (closing) throw Error('PB2_STARTUP_CLOSED');
    const value = await chromium.launch({headless: true});
    value.once('disconnected', () => {browserDisconnected = true;});
    return value;
  }, closeBrowser, () => closing, 15000);
}, 60000);

async function settle(page: Page): Promise<void> {
  await run('settle', () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
}
async function shape(locator: Locator, label: string): Promise<ControlMetrics> {
  return run('shape-' + label, () => locator.evaluate((el, label) => {
    const rect = el.getBoundingClientRect();
    let opacity = 1, left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node); opacity *= Number(style.opacity);
      if (node !== el) {
        const bounds = node.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX)) {left = Math.max(left, bounds.left + node.clientLeft); right = Math.min(right, bounds.left + node.clientLeft + node.clientWidth);}
        if (/hidden|clip|auto|scroll/.test(style.overflowY)) {top = Math.max(top, bounds.top + node.clientTop); bottom = Math.min(bottom, bounds.top + node.clientTop + node.clientHeight);}
      }
    }
    const hits = [.25, .5, .75].flatMap(x => [.25, .5, .75].map(y => {
      const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
      return !!hit && (el === hit || el.contains(hit));
    }));
    return {label, name: el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || null, width: rect.width, height: rect.height, opacity, clear: rect.left >= left - 1 && rect.right <= right + 1 && rect.top >= top - 1 && rect.bottom <= bottom + 1 && hits.every(Boolean), rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, hits};
  }, label));
}
async function tap(page: Page, locator: Locator, label: string): Promise<void> {
  await run('tap-' + label, () => locator.tap());
  await settle(page);
}

for (const theme of ['gold', 'mono'] as const) it('PB ' + theme + ' 320x640 populated history branch opens and cancels without restore or creation', async (): Promise<void> => {
  assert.ok(browser);
  const row: CaseResult = {theme, metrics: [], bodyComplete: false, closed: false, requests: [], faults: []};
  cases.push(row);
  const owner = {ended: false};
  const context = await acquireOwned(operations, 'PB-context', () => browser!.newContext({viewport: {width: 320, height: 640}, hasTouch: true, isMobile: true, reducedMotion: 'reduce', serviceWorkers: 'block'}), closeContext, () => closing || owner.ended);
  live.add(context);
  const pending = new Set<Request>(), handlers = new Set<Promise<void>>(), failures: unknown[] = [];
  let page: Page | undefined, mounted = false;
  try {
    page = await acquireOwned(operations, 'PB-page', () => context.newPage(), value => value.close(), () => closing || owner.ended);
    page.setDefaultTimeout(1500);
    page.on('pageerror', error => row.faults.push(error.message));
    page.on('console', message => {if (message.type() === 'error') row.faults.push(message.text());});
    context.on('request', request => {pending.add(request); row.requests.push({url: request.url(), method: request.method(), terminal: null});});
    context.on('requestfinished', request => {pending.delete(request); const record = row.requests.find(record => record.url === request.url() && record.terminal === null); if (record) record.terminal = 'finished';});
    context.on('requestfailed', request => {pending.delete(request); row.faults.push('REQUEST_FAILED:' + request.url());});
    await run('deny-ws', () => context.routeWebSocket('**/*', socket => {row.faults.push('WS_FORBIDDEN'); socket.close({code: 1008, reason: 'offline-only'});}));
    await run('route', () => context.route('**/*', async route => {
      const actual = (async (): Promise<void> => {
        const request = route.request(), headers = request.headers();
        assert.equal(request.url(), ORIGIN + '/'); assert.equal(request.isNavigationRequest(), true);
        assert.equal(request.method(), 'GET'); assert.equal(request.postData(), null);
        for (const key of ['authorization', 'cookie', 'x-api-key', 'api-key', 'idempotency-key']) assert.equal(headers[key], undefined);
        await route.fulfill({contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>' + css + '</style></head><body style="margin:0"><div id="fixture-root"></div></body></html>'});
      })();
      handlers.add(actual);
      try {await actual;} catch (error) {row.faults.push(String(error)); try {await route.abort('blockedbyclient');} catch (abortError) {row.faults.push(String(abortError));}} finally {handlers.delete(actual);}
    }));
    const currentPage = page;
    await run('goto', () => currentPage.goto(ORIGIN + '/'));
    await run('bundle', () => currentPage.addScriptTag({content: bundle})); mounted = true;
    await run('show', () => currentPage.evaluate(theme => window.pb.show(theme), theme)); await settle(page);
    const dock = page.getByRole('dialog', {name: '版本历史', exact: true});
    const entry = dock.getByRole('button', {name: '从 PB 原始版本 创建分支', exact: true});
    await run('ready', () => entry.waitFor({state: 'visible'}));
    row.device = await run('device', () => currentPage.evaluate(() => ({width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints, coarse: matchMedia('(pointer:coarse)').matches, hover: matchMedia('(hover:hover)').matches})));
    assert.deepEqual(row.device, {width: 320, height: 640, touch: 1, coarse: true, hover: false});
    const before = await run('snapshot-before', () => currentPage.evaluate(() => window.pb.snapshot())); row.before = before;
    assert.equal((JSON.parse(before.tree) as {nodes: unknown[]}).nodes.length, 2);
    row.metrics.push(await shape(entry, 'branch-entry'));
    await run('shot-entry', () => currentPage.screenshot({path: path.join(SHOTS, theme + '-entry.png')}));
    // Save initial visibility before the real tap: a successful tap cannot erase a hidden control.
    await tap(page, entry, 'open-branch');
    const heading = dock.getByRole('heading', {name: '创建新分支', exact: true});
    await run('dialog-ready', () => heading.waitFor({state: 'visible'}));
    const dialog = heading.locator('..').locator('..'), close = heading.locator('..').getByRole('button');
    const cancel = dialog.getByRole('button', {name: '取消', exact: true}), create = dialog.getByRole('button', {name: '创建', exact: true});
    for (const [label, control] of [['dialog-close', close], ['dialog-cancel', cancel], ['dialog-create', create]] as const) row.metrics.push(await shape(control, label));
    await run('shot-dialog', () => currentPage.screenshot({path: path.join(SHOTS, theme + '-dialog.png')}));
    await tap(page, cancel, 'cancel'); assert.equal(await heading.count(), 0);
    await tap(page, entry, 'reopen-branch'); await run('reopen-ready', () => heading.waitFor({state: 'visible'}));
    await tap(page, close, 'close-dialog'); assert.equal(await heading.count(), 0);
    await tap(page, dock.getByRole('button', {name: '关闭版本历史', exact: true}), 'close-history'); assert.equal(await dock.count(), 0);
    const after = await run('snapshot-after', () => currentPage.evaluate(() => window.pb.snapshot())); row.after = after;
    assert.equal(after.tree, before.tree); assert.equal(after.storage, before.storage);
    assert.equal(after.restore, 0); assert.equal(after.create, 0); assert.equal(after.close, 1); assert.deepEqual(after.errors, []);
    assert.equal(after.events.filter(event => event.type === 'pointerdown').length, 5);
    assert.equal(after.events.every(event => event.trusted), true);
    assert.equal(after.events.filter(event => event.type === 'pointerdown').every(event => event.pointer === 'touch'), true);
    row.bodyComplete = true;
    row.defects = row.metrics.flatMap(control => [...(control.opacity < .99 ? [control.label + ':hidden'] : []), ...(control.width < 44 || control.height < 44 ? [control.label + ':under44'] : []), ...(!control.name ? [control.label + ':unnamed'] : []), ...(!control.clear ? [control.label + ':clipped-or-covered'] : [])]);
    assert.deepEqual(row.defects, [], 'real touch controls must be visible, named, reachable and at least44px');
  } catch (error) {failures.push(error);}
  finally {
    owner.ended = true;
    try {
      if (mounted && page) {const currentPage = page; await run('unmount', () => currentPage.evaluate(() => window.pb.unmount()));}
      await run('routes-settle', () => Promise.all([...handlers]));
      assert.equal(pending.size, 0); assert.deepEqual(row.faults, []);
      assert.deepEqual(row.requests, [{url: ORIGIN + '/', method: 'GET', terminal: 'finished'}]);
    } catch (error) {failures.push(error);}
    try {await run('context-close', () => closeContext(context), 5000); row.closed = true; live.delete(context);} catch (error) {failures.push(error);}
  }
  fs.writeFileSync(path.join(SHOTS, theme + '-case.json'), JSON.stringify(row, null, 2) + '\n', {flag: 'wx'});
  console.log('PD_HISTORY_CASE ' + JSON.stringify({theme, bodyComplete: row.bodyComplete, closed: row.closed, defects: row.defects ?? null, failureCount: failures.length}));
  if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'PB_BODY_AND_CLEANUP');
}, 25000);

afterAll(async (): Promise<void> => {
  closing = true;
  const errors: unknown[] = [];
  for (const context of live) try {await run('remaining-context', () => closeContext(context), 5000); live.delete(context);} catch (error) {errors.push(error);}
  if (browser) try {await run('browser-close', () => closeBrowser(browser!), 5000);} catch (error) {errors.push(error);}
  const pending = operations.pendingPromises();
  if (pending.length) try {await run('drain', () => Promise.allSettled(pending), 5000);} catch (error) {errors.push(error);}
  const snapshot = operations.snapshot();
  const result = {browserDisconnected, browserConnected: browser?.isConnected() ?? false, contextsRemaining: live.size, operations: snapshot, errors: errors.map(error => String(error)), cases: cases.map(row => ({theme: row.theme, bodyComplete: row.bodyComplete, closed: row.closed, defects: row.defects ?? null})), noSql: true, noApplicationServer: true};
  if (ownsShots) fs.writeFileSync(path.join(SHOTS, 'resources.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log('PD_HISTORY_RESOURCES ' + JSON.stringify(result));
  assert.equal(live.size, 0);
  if (browser) assert.equal(browserDisconnected, true);
  assert.deepEqual(snapshot.pending, []); assert.deepEqual(snapshot.lateErrors, []);
  assert.equal(snapshot.operations.every(operation => operation.settled && !operation.timedOut && !operation.rejected), true);
  assert.deepEqual(errors, []);
}, 20000);
