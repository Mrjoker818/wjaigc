// @vitest-environment node
// Real shared LoginPanel, UserManager and shipped CSS. Local synthetic HTTP
// only; no business database, real accounts, private state or browser profile.
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Availability = 'open' | 'closed' | 'pending' | 'network';
type Reply = 'http' | 'missing' | 'invalid' | 'network' | 'success';
interface Options { availability?: Availability; action?: 'login' | 'register'; reply?: Reply; hold?: boolean; storageBlocked?: boolean; product?: 'canvas' | 'chat'; touch?: boolean }
interface FixtureWindow extends Window { authMobile: { mount(theme: string): void; unmount(): void; state: { calls: Array<{ id: string; product: string }>; disposed: boolean } } }
interface Gate { wait: Promise<void>; release(): void }
interface Session {
  context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>;
  pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; plannedFailed: Set<Request>;
  nativeWaiters: Set<() => void>; gates: Gate[]; mounted: boolean;
}
const ORIGIN = 'https://shared-auth-mobile.invalid';
const PASSWORD = 'Synthetic-ui-only-123!';
const ACTOR = 'mobile_ui_actor';
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LoginPanel} from '@/components/dashboard/login-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={calls:[] as Array<{id:string;product:string}>,disposed:false};
let mounted=false;
Object.assign(window,{authMobile:{state,mount(theme:string){
 if(mounted||state.disposed)throw Error('AUTH_FIXTURE_REMOUNT');mounted=true;
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
 root.render(<LoginPanel onLogin={(user,product)=>state.calls.push({id:user.id,product})}/>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '', logo: Buffer;
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('AUTH_FIXTURE_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const result = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'shared-auth-mobile-entry.tsx' } });
  if (result.outputFiles.length !== 1) throw Error('AUTH_FIXTURE_MEMORY_BUNDLE');
  bundle = result.outputFiles[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css'
        ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    } });
  css = compiler.build(new Scanner({}).scanFiles(sources)); logo = await readFile('public/logo.png');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => {
  const failures: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { failures.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { failures.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; }
  if (failures.length) throw Error(failures.join('\n'));
}, 15000);
function gate(): Gate { let release = (): void => {}; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }
async function bounded(name: string, run: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('AUTH_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function settle(page: Page): Promise<void> { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function session(width = 390, height = 844, options: Options = {}, theme = 'gold'): Promise<Session> {
  if (!browser) throw Error('AUTH_FIXTURE_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', ...(options.touch ? { hasTouch: true, isMobile: true } : {}) }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), pending: new Set(), completed: new Set(),
      failed: new Set(), refused: new Set(), plannedFailed: new Set(), nativeWaiters: new Set(), gates: [], mounted: false }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('AUTH_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('AUTH_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || url.search || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key']) throw Error('AUTH_FIXTURE_HTTP_BOUNDARY');
        const key = request.method() + ' ' + url.pathname, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count !== 1) throw Error('AUTH_FIXTURE_HTTP_COUNT ' + key);
        if (request.method() === 'GET') {
          if (request.postData() !== null) throw Error('AUTH_FIXTURE_GET_BODY');
          if (url.pathname === '/' && request.isNavigationRequest()) { await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return; }
          if (url.pathname === '/logo.png') { await route.fulfill({ contentType: 'image/png', body: logo }); return; }
          if (url.pathname === '/api/auth/register') {
            if (options.availability === 'pending') { const g = gate(); s.gates.push(g); await g.wait; }
            if (options.availability === 'network') { s.plannedFailed.add(request); await route.abort('failed'); return; }
            await route.fulfill({ json: { registrationEnabled: options.availability !== 'closed' } }); return;
          }
        }
        if (request.method() === 'POST' && options.action && url.pathname === '/api/auth/' + options.action) {
          if (!/^application\/json(?:;|$)/.test(headers['content-type'] ?? '')) throw Error('AUTH_FIXTURE_POST_TYPE');
          const expected = options.action === 'login' ? { name: ACTOR, password: PASSWORD, productType: options.product ?? 'chat' }
            : { name: ACTOR, password: PASSWORD, confirmPassword: PASSWORD, email: 'ui@example.invalid', productType: options.product ?? 'chat' };
          const actual = JSON.parse(request.postData() ?? 'null') as Record<string, unknown> | null;
          if (!actual || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort()) || Object.entries(expected).some(([key, want]) => actual[key] !== want)) throw Error('AUTH_FIXTURE_POST_CONTRACT');
          if (options.hold) { const g = gate(); s.gates.push(g); await g.wait; }
          if (options.reply === 'network') { s.plannedFailed.add(request); await route.abort('failed'); return; }
          if (options.reply === 'http') { await route.fulfill({ status: 403, json: { success: false, error: '合成拒绝，请检查输入' } }); return; }
          if (options.reply === 'invalid') { await route.fulfill({ contentType: 'application/json', body: '{invalid' }); return; }
          if (options.reply === 'success') { await route.fulfill({ json: { success: true, user: { id: 'ui_auth_success', name: ACTOR, role: 'user', status: 'active', productType: 'chat', createdAt: 1, updatedAt: 1 } } }); return; }
          await route.fulfill({ json: { success: false, error: '合成拒绝，请检查输入' } }); return;
        }
        throw Error('AUTH_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await page.goto(ORIGIN);
    if (options.storageBlocked) await page.evaluate(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Synthetic storage denial', 'SecurityError'); } }); });
    await page.addScriptTag({ content: bundle }); await page.evaluate(t => (window as unknown as FixtureWindow).authMobile.mount(t), theme); s.mounted = true;
    await page.getByRole('heading', { name: '选择入口', exact: true }).waitFor();
    if (!['pending', 'closed', 'network'].includes(options.availability ?? 'open')) await page.getByRole('button', { name: '立即注册', exact: true }).waitFor();
    await settle(page); return s;
  } catch (error) {
    try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } } catch (cleanup) { throw new AggregateError([error, cleanup], 'AUTH_FIXTURE_BOOTSTRAP'); }
    throw error;
  }
}
async function nativeRequestsFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined;
  try { await bounded('native requests', () => new Promise<void>(resolve => { notify = () => { if (!s.pending.size) resolve(); }; s.nativeWaiters.add(notify); notify(); })); }
  finally { if (notify) s.nativeWaiters.delete(notify); }
}
async function dispose(s: Session, refusal?: 'http' | 'websocket', cleanupProbe?: () => void): Promise<void> {
  const failures: string[] = [];
  try { if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).authMobile.unmount())); cleanupProbe?.(); } catch (error) { failures.push(String(error)); }
  for (const g of s.gates) g.release();
  try { await bounded('routes', () => Promise.all([...s.handlers])); await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const unresolved = s.pending.size !== 0 || s.handlers.size !== 0;
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  const required = ['GET /', 'GET /logo.png', 'GET /api/auth/register'];
  if (s.options.action) required.push('POST /api/auth/' + s.options.action);
  if (refusal === 'http') required.push('GET /unexpected');
  if (JSON.stringify([...s.counts.keys()].sort()) !== JSON.stringify(required.sort()) || [...s.counts.values()].some(n => n !== 1)) throw Error('AUTH_FIXTURE_REQUEST_VALIDATION');
  const keyOf = (r: Request): string => r.method() + ' ' + new URL(r.url()).pathname;
  const abortKeys: string[] = [];
  if (s.options.availability === 'network') abortKeys.push('GET /api/auth/register');
  if (s.options.action && s.options.reply === 'network') abortKeys.push('POST /api/auth/' + s.options.action);
  if (JSON.stringify([...s.plannedFailed].map(keyOf).sort()) !== JSON.stringify(abortKeys.sort())) throw Error('AUTH_FIXTURE_NATIVE_ABORT_CONTRACT');
  const expectedFailed = new Set(s.plannedFailed);
  const refused = [...s.refused];
  if (refusal === 'http') {
    if (refused.length !== 1 || keyOf(refused[0]) !== 'GET /unexpected') throw Error('AUTH_FIXTURE_REFUSAL_CONTRACT');
    expectedFailed.add(refused[0]);
  } else if (refused.length) throw Error('AUTH_FIXTURE_UNEXPECTED_REFUSAL');
  const failedKeys = [...abortKeys, ...(refusal === 'http' ? ['GET /unexpected'] : [])];
  const expectedCompleted = required.filter(key => !failedKeys.includes(key)).sort();
  if (unresolved || s.pending.size || s.failed.size !== expectedFailed.size || [...s.failed].some(r => !expectedFailed.has(r))
    || JSON.stringify([...s.completed].map(keyOf).sort()) !== JSON.stringify(expectedCompleted)
    || s.completed.size + s.failed.size !== required.length) throw Error('AUTH_FIXTURE_NATIVE_REQUEST_FAILURE');
  if (failures.length) throw Error('AUTH_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (refusal) {
    const expected = refusal === 'http' ? 'Error: AUTH_FIXTURE_UNKNOWN_HTTP GET /unexpected' : 'AUTH_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('AUTH_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (s.errors.length) throw Error('AUTH_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(width: number, height: number, options: Options, run: (s: Session) => Promise<void>, theme = 'gold'): Promise<void> {
  const s = await session(width, height, options, theme); let primary: unknown;
  try { await run(s); } catch (error) { primary = error; }
  try { await dispose(s); } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'AUTH_FIXTURE_TEST_AND_CLEANUP'); throw cleanup; }
  if (primary) throw primary;
}
function shell(s: Session): Locator { return s.page.locator('#fixture-root > div'); }
async function reveal(s: Session, control: Locator): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const r = await control.boundingBox(), clip = await shell(s).boundingBox(); if (!r || !clip) throw Error('AUTH_FIXTURE_SCROLL_RECT');
    if (r.y >= 1 && r.y + r.height <= s.page.viewportSize()!.height - 1) return;
    const delta = r.y < 1 ? r.y - 4 : r.y + r.height - s.page.viewportSize()!.height + 4;
    await s.page.mouse.move(clip.x + clip.width / 2, Math.min(s.page.viewportSize()!.height - 10, clip.y + clip.height / 2)); await s.page.mouse.wheel(0, delta); await settle(s.page);
  }
  const r = await control.boundingBox(); expect(!!r && r.y >= 0 && r.y + r.height <= s.page.viewportSize()!.height, 'native scroll reaches target').toBe(true);
}
async function target(control: Locator, minimum = 44): Promise<void> {
  const value = await control.evaluate(element => {
    const r = element.getBoundingClientRect(); let clear = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const b = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < b.left + parent.clientLeft - 0.5 || r.right > b.left + parent.clientLeft + parent.clientWidth + 0.5)) clear = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < b.top + parent.clientTop - 0.5 || r.bottom > b.top + parent.clientTop + parent.clientHeight + 0.5)) clear = false;
    }
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { width: r.width, height: r.height, clear, hit: [[x, y], [r.left + 8, y], [r.right - 8, y], [x, r.top + 8], [x, r.bottom - 8]].every(([a, b], index) => {
      const hit = document.elementFromPoint(a, b); if (element.contains(hit)) return true;
      // The trailing password region deliberately belongs to its sibling eye.
      // Only that one point may hit the actual named native type=button inside
      // this field; the input center/left/top/bottom must still hit the input.
      const eye = hit?.closest('button');
      return index === 2 && element instanceof HTMLInputElement && Number.parseFloat(getComputedStyle(element).paddingRight) >= 44
        && eye?.parentElement === element.parentElement && eye?.type === 'button'
        && ['显示密码', '隐藏密码'].includes(eye.getAttribute('aria-label') ?? '');
    }) };
  });
  expect(value.clear, 'whole target visible').toBe(true); expect(value.width, 'target width').toBeGreaterThanOrEqual(minimum); expect(value.height, 'target height').toBeGreaterThanOrEqual(minimum); expect(value.hit, 'native hit').toBe(true);
}
async function click(s: Session, control: Locator): Promise<void> { await reveal(s, control); await control.click(); await settle(s.page); }
async function enter(s: Session, form: 'login' | 'register', product = 'chat'): Promise<void> {
  await click(s, s.page.getByRole('button', { name: product === 'chat' ? /^智能对话/ : /^无限画布/ }));
  if (form === 'register') await click(s, s.page.getByRole('button', { name: '立即注册', exact: true }));
}
async function values(s: Session, form: 'login' | 'register'): Promise<void> {
  const fields = form === 'login' ? [['请输入用户名', '  ' + ACTOR + '  '], ['请输入密码', PASSWORD]]
    : [['3-32位，字母/数字/下划线', '  ' + ACTOR + '  '], ['至少 6 位', PASSWORD], ['再次输入密码', PASSWORD], ['example@domain.com', 'ui@example.invalid']];
  for (const [placeholder, value] of fields) { const input = s.page.getByPlaceholder(placeholder, { exact: true }); await reveal(s, input); await input.fill(value); }
}
async function capture(s: Session, name: string): Promise<void> {
  const directory = path.resolve('output/mobile-ui/shared-auth-native-20261018', String(process.pid)); await mkdir(directory, { recursive: true });
  const file = path.join(directory, name + '.png'); await s.page.screenshot({ path: file });
  console.log('AUTH_NATIVE_CAPTURE', JSON.stringify({ path: file, physicalTouch: false, coze: false }));
}
describe('auth label focus', () => {
  it.each([
    ['login', '请输入用户名'], ['login', '请输入密码'], ['register', '3-32位，字母/数字/下划线'],
    ['register', '至少 6 位'], ['register', '再次输入密码'], ['register', 'example@domain.com'],
  ] as const)('%s %s focuses its associated input by native label click', async (form, placeholder) => {
    await withSession(390, 844, {}, async s => {
      await enter(s, form); const input = s.page.getByPlaceholder(placeholder, { exact: true }); const label = input.locator('xpath=../..').locator('label').first();
      // Email has no inner relative wrapper.
      const ownLabel = placeholder === 'example@domain.com' ? input.locator('..').locator('label') : label;
      await click(s, ownLabel); expect(await input.evaluate(e => e === document.activeElement), 'label click focuses input').toBe(true);
    });
  }, 15000);
});
describe('auth native scroll', () => {
  it.each(['mode', 'login', 'register'] as const)('%s reaches top and bottom in short landscape without script scrolling', async form => {
    await withSession(640, 320, {}, async s => {
      if (form !== 'mode') await enter(s, form);
      const last = s.page.getByRole('button', { name: form === 'register' ? '立即登录' : '立即注册', exact: true }); await reveal(s, last); await target(last, 0);
      const first = form === 'mode' ? s.page.getByRole('heading', { name: '选择入口', exact: true }) : s.page.getByTitle('返回选择模式');
      await reveal(s, first); await target(first, 0);
    });
  }, 15000);
});
describe('auth mobile controls', () => {
  it.each(['gold', 'mono'].flatMap(theme => [[320, 640], [390, 844], [640, 320]].map(([width, height]) => ({ theme, width, height }))))
  ('$theme $width x $height keeps all three views usable', async ({ theme, width, height }) => {
    await withSession(width, height, {}, async s => {
      for (const control of await s.page.getByRole('button').all()) { await reveal(s, control); await target(control); }
      await capture(s, theme + '-' + width + 'x' + height + '-mode');
      await enter(s, 'login');
      for (const control of await s.page.locator('input,button').all()) { await reveal(s, control); await target(control); }
      for (const input of await s.page.locator('input').all()) expect(await input.evaluate(e => Number.parseFloat(getComputedStyle(e).fontSize)), 'login input avoids mobile auto zoom').toBeGreaterThanOrEqual(16);
      await capture(s, theme + '-' + width + 'x' + height + '-login');
      const password = s.page.getByPlaceholder('请输入密码'); await reveal(s, password); await password.fill(PASSWORD);
      const eye = s.page.getByRole('button', { name: '显示密码', exact: true }); await click(s, eye); expect(await password.getAttribute('type')).toBe('text'); expect(await password.inputValue()).toBe(PASSWORD);
      await click(s, s.page.getByRole('button', { name: '隐藏密码', exact: true })); expect(await password.getAttribute('type')).toBe('password');
      await click(s, s.page.getByRole('button', { name: '立即注册', exact: true }));
      for (const control of await s.page.locator('input,button').all()) { await reveal(s, control); await target(control); }
      for (const input of await s.page.locator('input').all()) expect(await input.evaluate(e => Number.parseFloat(getComputedStyle(e).fontSize)), 'input avoids mobile auto zoom').toBeGreaterThanOrEqual(16);
      expect(await shell(s).evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'no horizontal leak').toBe(true);
      await capture(s, theme + '-' + width + 'x' + height + '-register');
      await click(s, s.page.getByTitle('返回选择模式')); await s.page.getByRole('heading', { name: '选择入口', exact: true }).waitFor();
    }, theme);
  }, 25000);
});
describe('auth conditional interaction', () => {
  it.each(['open', 'closed', 'pending', 'network'] as const)('registration availability %s is respected and teardown converges', async availability => {
    await withSession(390, 844, { availability }, async s => {
      if (availability === 'network') await nativeRequestsFinished(s);
      expect(await s.page.getByRole('button', { name: '立即注册', exact: true }).count()).toBe(availability === 'open' ? 1 : 0);
      await enter(s, 'login'); expect(await s.page.getByRole('button', { name: '立即注册', exact: true }).count()).toBe(availability === 'open' ? 1 : 0);
    });
  }, 15000);
  it('independent registration visibility and return preserve drafts without submission', async () => {
    await withSession(390, 844, {}, async s => {
      await enter(s, 'register'); await values(s, 'register'); const fields = [s.page.getByPlaceholder('至少 6 位', { exact: true }), s.page.getByPlaceholder('再次输入密码', { exact: true })];
      for (const input of fields) {
        const button = input.locator('..').getByRole('button'); await click(s, button); expect(await input.getAttribute('type')).toBe('text'); expect(await button.getAttribute('aria-pressed')).toBe('true'); expect(await input.inputValue()).toBe(PASSWORD);
      }
      await click(s, fields[0].locator('..').getByRole('button')); expect(await fields[0].getAttribute('type')).toBe('password'); expect(await fields[1].getAttribute('type')).toBe('text');
      await click(s, s.page.getByRole('button', { name: '立即登录', exact: true })); await click(s, s.page.getByRole('button', { name: '立即注册', exact: true })); expect(await fields[0].inputValue()).toBe(PASSWORD);
      await click(s, s.page.getByTitle('返回选择模式')); await enter(s, 'register'); expect(await fields[1].inputValue()).toBe(PASSWORD);
    });
  }, 20000);
  it.each(['login', 'register'] as const)('%s disables submission and fields while the exact synthetic request is pending', async action => {
    await withSession(390, 844, { action, hold: true, reply: 'missing' }, async s => {
      await enter(s, action); await values(s, action); await click(s, s.page.getByRole('button', { name: action === 'login' ? '登录' : '创建账号', exact: true }));
      await s.page.getByRole('button', { name: action === 'login' ? '登录中...' : '注册中...', exact: true }).waitFor();
      expect(await s.page.getByRole('button', { name: action === 'login' ? '登录中...' : '注册中...', exact: true }).isDisabled()).toBe(true);
      await expect.poll(() => s.gates.length === 1 && [...s.pending].some(r => r.method() === 'POST' && r.url() === ORIGIN + '/api/auth/' + action), { timeout: 1500 }).toBe(true);
      expect(s.counts.get('POST /api/auth/' + action)).toBe(1);
      for (const input of await s.page.locator('input').all()) expect(await input.isDisabled()).toBe(true);
      for (const eye of await s.page.getByRole('button', { name: '显示密码', exact: true }).all()) expect(await eye.isDisabled()).toBe(true);
      for (const g of s.gates) g.release(); await s.page.getByText('合成拒绝，请检查输入', { exact: true }).waitFor();
      for (const input of await s.page.locator('input').all()) expect(await input.isEnabled()).toBe(true);
    });
  }, 20000);
  it.each(['login', 'register'] as const)('%s initialization failure has a visible recovery without HTTP submission', async action => {
    await withSession(390, 844, { storageBlocked: true }, async s => {
      await enter(s, action); await values(s, action); await click(s, s.page.getByRole('button', { name: action === 'login' ? '登录' : '创建账号', exact: true }));
      await s.page.getByText(action === 'login' ? '登录组件初始化失败，请刷新页面后重试' : '注册组件初始化失败，请刷新页面后重试', { exact: true }).waitFor();
      expect(await s.page.locator('input:disabled').count()).toBe(0);
    });
  }, 20000);
  it.each(['login', 'register'] as const)('%s synthetic chat success calls the existing consumer once without project hydration', async action => {
    await withSession(390, 844, { action, reply: 'success' }, async s => {
      await enter(s, action); await values(s, action); await click(s, s.page.getByRole('button', { name: action === 'login' ? '登录' : '创建账号', exact: true }));
      await s.page.waitForFunction(() => (window as unknown as FixtureWindow).authMobile.state.calls.length === 1);
      expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).authMobile.state.calls)).toEqual([{ id: 'ui_auth_success', product: 'chat' }]);
    });
  }, 20000);
  it.each(['http', 'missing', 'invalid', 'network'] as const)('login %s keeps recovery controls and preserves the draft', async reply => {
    await withSession(390, 844, { action: 'login', reply, product: 'canvas' }, async s => {
      await enter(s, 'login', 'canvas'); await values(s, 'login'); await click(s, s.page.getByRole('button', { name: '登录', exact: true }));
      await s.page.getByText(reply === 'http' ? '登录失败，请检查用户名、密码或授权' : reply === 'missing' ? '合成拒绝，请检查输入' : '登录失败，网络异常', { exact: true }).waitFor();
      expect(await s.page.getByPlaceholder('请输入密码').inputValue()).toBe(PASSWORD); expect(await s.page.getByRole('button', { name: '登录', exact: true }).isEnabled()).toBe(true);
      await click(s, s.page.getByTitle('返回选择模式')); await enter(s, 'login'); expect(await s.page.getByText('登录失败，网络异常', { exact: true }).count()).toBe(0);
    });
  }, 20000);
  it.each(['missing', 'invalid', 'network'] as const)('register %s keeps recovery controls without creating an account', async reply => {
    await withSession(390, 844, { action: 'register', reply }, async s => {
      await enter(s, 'register'); await values(s, 'register'); await click(s, s.page.getByRole('button', { name: '创建账号', exact: true }));
      await s.page.getByText(reply === 'missing' ? '合成拒绝，请检查输入' : '注册失败，网络异常', { exact: true }).waitFor();
      expect(await s.page.getByRole('button', { name: '创建账号', exact: true }).isEnabled()).toBe(true);
    });
  }, 20000);
  it.each(['请输入用户名', '请输入密码'])('native Enter from %s submits only once and preserves recovery', async placeholder => {
    await withSession(390, 844, { action: 'login', reply: 'missing' }, async s => {
      await enter(s, 'login'); await values(s, 'login'); const input = s.page.getByPlaceholder(placeholder, { exact: true }); await reveal(s, input); await input.press('Enter');
      await s.page.getByText('合成拒绝，请检查输入', { exact: true }).waitFor(); expect(s.counts.get('POST /api/auth/login')).toBe(1);
    });
  }, 20000);
});
describe('auth error accessibility', () => {
  it.each(['login', 'register'] as const)('%s exposes the visible error to assistive technology', async action => {
    await withSession(390, 844, { action, reply: 'missing' }, async s => {
      await enter(s, action); await values(s, action); await click(s, s.page.getByRole('button', { name: action === 'login' ? '登录' : '创建账号', exact: true }));
      await s.page.getByText('合成拒绝，请检查输入', { exact: true }).waitFor(); const alert = s.page.getByRole('alert'); expect(await alert.count(), 'error announcement').toBe(1);
      expect(await alert.isVisible()).toBe(true); expect(await alert.getByText('合成拒绝，请检查输入', { exact: true }).count()).toBe(1);
    });
  }, 20000);
});
async function textContrast(control: Locator, placeholder = false): Promise<number> {
  return control.evaluate((element, isPlaceholder) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('AUTH_FIXTURE_CONTRAST_CANVAS');
    type Rgba = [number, number, number, number]; type Rgb = [number, number, number];
    const rgba = (value: string): Rgba => {
      if (!CSS.supports('color', value) || /^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value)) throw Error('AUTH_FIXTURE_CONTRAST_COLOR');
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const blend = (front: Rgba, back: Rgb): Rgb => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])) as Rgb;
    const luminance = (rgb: Rgb): number => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (ratio([255, 255, 255], [255, 255, 255]) !== 1 || Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) > 0.000001) throw Error('AUTH_FIXTURE_CONTRAST_CANARY');
    const layers: Rgba[] = []; let opaque = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backgroundImage !== 'none') throw Error('AUTH_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
      const color = rgba(style.backgroundColor); layers.push(color); if (color[3] === 1) { opaque = true; break; }
    }
    if (!opaque) throw Error('AUTH_FIXTURE_CONTRAST_BACKDROP_REQUIRED');
    let backdrop: Rgb = [255, 255, 255]; for (const layer of layers.reverse()) backdrop = blend(layer, backdrop);
    const own = getComputedStyle(element); if (own.filter !== 'none' || own.mixBlendMode !== 'normal' || own.backgroundImage !== 'none') throw Error('AUTH_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
    const background = blend(rgba(own.backgroundColor), backdrop), ownOpacity = Number(own.opacity);
    const text = isPlaceholder ? getComputedStyle(element, '::placeholder') : own;
    const paint = rgba(text.color); if (isPlaceholder) paint[3] *= Number(text.opacity);
    return ratio(blend([...blend(paint, background), ownOpacity], backdrop), blend([...background, ownOpacity], backdrop));
  }, placeholder);
}
describe('auth theme contrast', () => {
  it.each(['gold', 'mono'].flatMap(theme => ['mode', 'login', 'register'].map(form => ({ theme, form }))))
  ('$theme $form keeps headings labels placeholders and actions readable', async ({ theme, form }) => {
    await withSession(390, 844, {}, async s => {
      if (form !== 'mode') await enter(s, form as 'login' | 'register');
      const controls = [s.page.getByRole('heading', { level: 2 }), s.page.locator('p.text-center')];
      controls.push(...await s.page.locator('label,label span,input,button[type="submit"],p.text-center button').all());
      const samples: Array<{ text: string; ratio: number; placeholder: boolean }> = [];
      for (const control of controls) {
        await reveal(s, control); const placeholder = await control.evaluate(e => e instanceof HTMLInputElement);
        const value = await textContrast(control, placeholder); const text = await control.evaluate(e => e instanceof HTMLInputElement ? e.placeholder : e.textContent ?? '');
        samples.push({ text, ratio: value, placeholder }); expect(value, 'auth readable text contrast').toBeGreaterThanOrEqual(4.5);
      }
      console.log('AUTH_TEXT_CONTRAST', JSON.stringify({ theme, form, samples }));
    }, theme);
  }, 25000);
});
describe('auth viewport fill', () => {
  it.each(['gold', 'mono'].flatMap(theme => [[390, 844], [1440, 900]].map(([width, height]) => ({ theme, width, height }))))
  ('$theme $width x $height fills the viewport without an unpainted lower region', async ({ theme, width, height }) => {
    await withSession(width, height, {}, async s => {
      const value = await shell(s).locator(':scope > div').evaluate(e => e.getBoundingClientRect().height);
      console.log('AUTH_HEIGHT_CASCADE', JSON.stringify(await shell(s).locator(':scope > div').evaluate(e => ({ contentHeight: e.getBoundingClientRect().height, contentMinHeight: getComputedStyle(e).minHeight, rootHeight: e.parentElement!.getBoundingClientRect().height, rootCssHeight: getComputedStyle(e.parentElement!).height }))));
      expect(value, 'auth content fills viewport').toBeGreaterThanOrEqual(height);
    }, theme);
  }, 15000);
});
describe('auth contrast measurement', () => {
  it('classifies transparent text as invisible rather than high contrast', async () => {
    await withSession(390, 844, {}, async s => {
      const heading = s.page.getByRole('heading', { level: 2 }); await heading.evaluate(e => { (e as HTMLElement).style.color = 'transparent'; }); await settle(s.page);
      expect(await textContrast(heading)).toBe(1);
    });
  }, 15000);
  it('rejects unsupported gradient backdrops rather than assuming a flat color', async () => {
    await withSession(390, 844, {}, async s => {
      const heading = s.page.getByRole('heading', { level: 2 }); await heading.evaluate(e => { e.parentElement!.style.backgroundImage = 'linear-gradient(black,white)'; }); await settle(s.page);
      await expect(textContrast(heading)).rejects.toThrow('AUTH_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
    });
  }, 15000);
});
describe('auth desktop rotation', () => {
  it.each(['gold', 'mono'])('%s preserves the form across orientation and desktop changes', async theme => {
    await withSession(1440, 900, {}, async s => {
      await enter(s, 'register'); await values(s, 'register');
      for (const [width, height] of [[320, 640], [640, 320], [1440, 900]]) {
        await s.page.setViewportSize({ width, height }); await settle(s.page); const submit = s.page.getByRole('button', { name: '创建账号', exact: true }); await reveal(s, submit); await target(submit, 0);
        expect(await s.page.getByPlaceholder('至少 6 位', { exact: true }).inputValue()).toBe(PASSWORD);
      }
      await capture(s, theme + '-desktop');
    }, theme);
  }, 25000);
});
describe('auth fixture boundary', () => {
  it.each(['login', 'register'] as const)('rejects a missing promised %s POST rather than accepting a network error without submission', async action => {
    const s = await session(390, 844, { action, reply: 'network' });
    await expect(dispose(s)).rejects.toThrow('AUTH_FIXTURE_REQUEST_VALIDATION');
    expect(live.has(s)).toBe(false); expect(contexts.has(s.context)).toBe(false);
  }, 15000);
  it.each(['http', 'websocket'] as const)('refuses unknown %s with a separate infrastructure verdict', async transport => {
    const s = await session();
    try {
      if (transport === 'http') expect(await s.page.evaluate(async () => { try { await fetch('/unexpected'); return false; } catch { return true; } })).toBe(true);
      else expect(await s.page.evaluate(() => new Promise<number>((resolve, reject) => { const socket = new WebSocket('wss://unexpected.invalid'); const timer = setTimeout(() => reject(Error('AUTH_FIXTURE_WS_TIMEOUT')), 1500); socket.onclose = e => { clearTimeout(timer); resolve(e.code); }; }))).toBe(1008);
      await expect(dispose(s, transport)).rejects.toThrow(transport === 'http' ? 'AUTH_FIXTURE_INFRASTRUCTURE: Error: AUTH_FIXTURE_UNKNOWN_HTTP GET /unexpected' : 'AUTH_FIXTURE_INFRASTRUCTURE: AUTH_FIXTURE_UNKNOWN_WS');
    } finally { if (live.has(s)) await dispose(s); }
  }, 15000);
  it.each(['http', 'websocket'] as const)('cannot hide a cleanup fault inside expected %s refusal', async transport => {
    const s = await session();
    try {
      if (transport === 'http') await s.page.evaluate(async () => { try { await fetch('/unexpected'); } catch { /* expected */ } });
      else await s.page.evaluate(() => new Promise<void>((resolve, reject) => { const socket = new WebSocket('wss://unexpected.invalid'); const timer = setTimeout(() => reject(Error('AUTH_FIXTURE_WS_TIMEOUT')), 1500); socket.onclose = () => { clearTimeout(timer); resolve(); }; }));
      await expect(dispose(s, transport, () => { throw Error('AUTH_FIXTURE_INJECTED_CLEANUP'); })).rejects.toThrow('AUTH_FIXTURE_CLEANUP_FAILURE: Error: AUTH_FIXTURE_INJECTED_CLEANUP');
      expect(live.has(s)).toBe(false); expect(contexts.has(s.context)).toBe(false);
    } finally { if (live.has(s)) await dispose(s); }
  }, 15000);
});


// RG adds native-touch evidence for the existing password eye only. It never
// submits either form or represents a physical keyboard/device acceptance.
for (const theme of ['gold', 'mono']) {
  it('RG password ' + theme + ' toggles by native touch without changing or submitting credentials', async () => {
    await withSession(390, 844, { touch: true }, async s => {
      const entry = s.page.getByRole('button', { name: /^智能对话/ });
      await target(entry); await entry.tap(); await settle(s.page);
      const username = s.page.getByPlaceholder('请输入用户名', { exact: true });
      const password = s.page.getByPlaceholder('请输入密码', { exact: true });
      await target(username); await username.fill(ACTOR);
      await target(password); await password.fill(PASSWORD);
      const profile = await s.page.evaluate(() => ({
        touchPoints: navigator.maxTouchPoints,
        coarse: matchMedia('(pointer: coarse)').matches,
        noHover: matchMedia('(hover: none)').matches,
        width: innerWidth, height: innerHeight,
      }));
      expect(profile.touchPoints).toBeGreaterThan(0);
      expect(profile.coarse).toBe(true); expect(profile.noHover).toBe(true);
      expect(profile.width).toBe(390); expect(profile.height).toBe(844);
      const show = s.page.getByRole('button', { name: '显示密码', exact: true });
      const before = await show.evaluate(el => {
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        return { width: r.width, height: r.height, type: (el as HTMLButtonElement).type,
          visible: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          hit: el.contains(document.elementFromPoint(x, y)) };
      });
      console.log('RG_PASSWORD_TARGET', JSON.stringify({ theme, profile, before }));
      await target(show); expect(before.type).toBe('button');
      expect(await password.getAttribute('type')).toBe('password');
      await show.tap(); await settle(s.page);
      const hide = s.page.getByRole('button', { name: '隐藏密码', exact: true });
      await target(hide);
      expect(await password.getAttribute('type')).toBe('text');
      expect(await password.inputValue()).toBe(PASSWORD);
      expect(await username.inputValue()).toBe(ACTOR);
      await hide.tap(); await settle(s.page);
      await target(s.page.getByRole('button', { name: '显示密码', exact: true }));
      expect(await password.getAttribute('type')).toBe('password');
      expect(await password.inputValue()).toBe(PASSWORD);
      expect(await username.inputValue()).toBe(ACTOR);
      const posts = [...s.counts.entries()].filter(([key]) => key.startsWith('POST '));
      expect(posts).toEqual([]);
      expect(await s.page.evaluate(() => (window as unknown as FixtureWindow).authMobile.state.calls)).toEqual([]);
      await capture(s, 'rg-' + theme + '-password-touch-complete');
      console.log('RG_PASSWORD_TOUCH_COMPLETE', JSON.stringify({ theme, viewport: '390x844',
        nativeTap: true, passwordRehidden: true, valuesRetained: true, targets44: true,
        zeroPost: true, loginCallbacks: 0, syntheticCredentialsOnly: true,
        physicalAndroid: false, physicalKeyboard: false, wholeAuthAccepted: false }));
    }, theme);
  }, 15000);
}
