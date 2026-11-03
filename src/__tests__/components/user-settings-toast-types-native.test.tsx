// @vitest-environment node
// Real settings component and Toaster; only isolated storage and intercepted synthetic requests.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser } from '@playwright/test';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://user-settings-toast.invalid';
type ToastType = 'success' | 'error' | 'info';
type ResponseKind = 'http' | 'fallback' | 'network' | 'success';
interface Scenario {
  name: string; action: 'save' | 'password' | 'info'; type: ToastType; message: string;
  refuse?: boolean; password?: string; confirm?: string; response?: ResponseKind;
}
const SCENARIOS: Scenario[] = [
  { name: 'save refused', action: 'save', refuse: true, type: 'error', message: '保存失败，请重试' },
  { name: 'save succeeds', action: 'save', type: 'success', message: '设置已保存' },
  { name: 'password too short', action: 'password', password: 'abc', confirm: 'abc', type: 'error', message: '密码至少6位' },
  { name: 'password mismatch', action: 'password', password: 'synthetic-pass', confirm: 'synthetic-other', type: 'error', message: '两次输入的密码不一致' },
  { name: 'password server rejects', action: 'password', password: 'synthetic-pass', confirm: 'synthetic-pass', response: 'http', type: 'error', message: '合成服务拒绝' },
  { name: 'password server default error', action: 'password', password: 'synthetic-pass', confirm: 'synthetic-pass', response: 'fallback', type: 'error', message: '密码修改失败' },
  { name: 'password network failure', action: 'password', password: 'synthetic-pass', confirm: 'synthetic-pass', response: 'network', type: 'error', message: '请求失败' },
  { name: 'password succeeds', action: 'password', password: 'synthetic-pass', confirm: 'synthetic-pass', response: 'success', type: 'success', message: '密码修改成功' },
  { name: 'login history information', action: 'info', type: 'info', message: '登录记录功能即将上线，敬请期待' },
];
interface FixtureWindow extends Window {
  settingsFixture: { dispose(): void; state: { attempts: string[]; toasts: string[]; themeCalls: number; disposed: boolean } };
  refuseSettings: boolean;
}

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const dashboard = await readFile(path.resolve('src/components/dashboard/dashboard-view.tsx'), 'utf8');
  const sourceFile = ts.createSourceFile('dashboard-view.tsx', dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'UserSettingsTab') {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(sourceFile) === 'onToast'
          && prop.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression) {
          callbacks.push(prop.initializer.expression.getText(sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (callbacks.length !== 1) throw Error('EXPECTED_ONE_DASHBOARD_SETTINGS_TOAST_CALLBACK');
  const entry = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import UserSettingsTab from '@/components/dashboard/user-settings-tab';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
const state = { attempts: [] as string[], toasts: [] as string[], themeCalls: 0, disposed: false };
const originalSet = Storage.prototype.setItem;
Storage.prototype.setItem = function(key: string, value: string) {
  if (key === 'wujie_user_settings') {
    state.attempts.push(value);
    if ((window as any).refuseSettings) throw new DOMException('synthetic refusal', 'QuotaExceededError');
  }
  return originalSet.call(this, key, value);
};
const root = createRoot(document.getElementById('fixture-root')!);
const parentCallback = ${callbacks[0]};
Object.assign(window, { settingsFixture: { state, dispose() { root.unmount(); Storage.prototype.setItem = originalSet; state.disposed = true; } } });
root.render(<><main className="h-dvh min-w-0 overflow-y-auto bg-background text-foreground">
  <UserSettingsTab isDark={true} isMonochrome={false} themePreference="dark" userName="合成用户" userRole="user"
    onToggleTheme={() => { state.themeCalls++; throw Error('FORBIDDEN_THEME_CHANGE'); }}
    onToast={(message, type) => { state.toasts.push(message); parentCallback(message, type); }} />
</main><Toaster theme="dark" /></>);
`;
  const require = createRequire(import.meta.url);
  const result = await build({ write: false, bundle: true, metafile: true, outfile: 'fixture.js',
    platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'user-settings-toast-entry.tsx' } });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  const inputs = Object.keys(result.metafile.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(inputs.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: entry, extension: 'tsx' });
  css = compiler.build(new Scanner({}).scanFiles(sources)) + '\n' + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  const js = result.outputFiles.find(file => file.path.endsWith('.js'));
  if (!js) throw Error('BUNDLE_MISSING');
  bundle = js.text;
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
}, 30000);

afterAll(async () => { await browser?.close(); browser = undefined; }, 15000);

describe('settings notification types', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      if (!browser) throw Error('BROWSER_NOT_STARTED');
      const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage(), requests: string[] = [], errors: string[] = [], pending = new Set<Promise<void>>();
      page.setDefaultTimeout(4000);
      page.on('pageerror', error => errors.push('PAGE ' + error.message));
      await context.routeWebSocket('**/*', socket => { errors.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
      await context.route('**/*', async route => {
        const task = (async () => {
          const request = route.request(), url = new URL(request.url()), headers = request.headers();
          const key = `${request.method()} ${url.pathname}${url.search}`;
          requests.push(key);
          if (url.origin !== ORIGIN || url.username || url.password || headers.cookie || headers.authorization || headers['x-api-key']) throw Error('NETWORK_BOUNDARY');
          if (key === 'GET /' && requests.length === 1 && request.postData() === null) {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="fixture-root"></div></body></html>' });
            return;
          }
          if (key === 'POST /api/user/change-password' && scenario.response && requests.length === 2
            && request.postData() === JSON.stringify({ newPassword: 'synthetic-pass' })) {
            if (scenario.response === 'network') await route.abort('failed');
            else if (scenario.response === 'http') await route.fulfill({ status: 403, json: { error: '合成服务拒绝' } });
            else if (scenario.response === 'fallback') await route.fulfill({ status: 403, json: {} });
            else await route.fulfill({ status: 200, json: { success: true } });
            return;
          }
          throw Error('UNEXPECTED_REQUEST ' + key);
        })();
        pending.add(task);
        try { await task; } catch (error) { errors.push(String(error)); await route.abort('blockedbyclient').catch(() => {}); }
        finally { pending.delete(task); }
      });
      let mounted = false;
      try {
        await page.goto(ORIGIN + '/');
        await page.addStyleTag({ content: css });
        await page.evaluate(refuse => { (window as unknown as FixtureWindow).refuseSettings = refuse; }, !!scenario.refuse);
        await page.addScriptTag({ content: bundle });
        mounted = true;
        await page.getByRole('heading', { name: '个人资料', exact: true }).waitFor();
        if (scenario.action === 'save') {
          await page.getByRole('combobox', { name: '默认画质', exact: true }).selectOption('ultra');
          const save = page.getByRole('button', { name: '保存设置', exact: true });
          await save.scrollIntoViewIfNeeded();
          await save.tap();
        } else if (scenario.action === 'password') {
          const open = page.getByRole('button', { name: '修改密码', exact: true });
          await open.scrollIntoViewIfNeeded();
          await open.tap();
          await page.getByLabel('新密码', { exact: true }).fill(scenario.password!);
          await page.getByLabel('确认密码', { exact: true }).fill(scenario.confirm!);
          await page.getByRole('button', { name: '确认修改', exact: true }).tap();
        } else {
          const info = page.getByRole('button', { name: '登录记录', exact: true });
          await info.scrollIntoViewIfNeeded();
          await info.tap();
        }
        const message = page.getByText(scenario.message, { exact: true });
        await message.waitFor();
        const toast = message.locator('xpath=ancestor::*[@data-sonner-toast]');
        expect(await toast.getAttribute('data-type')).toBe(scenario.type);
        const iconClass: Record<ToastType, string> = { success: 'lucide-circle-check', error: 'lucide-octagon-x', info: 'lucide-info' };
        expect(await toast.locator(`[data-icon] svg.${iconClass[scenario.type]}`).count()).toBe(1);
        const state = await page.evaluate(() => ({ fixture: (window as unknown as FixtureWindow).settingsFixture.state,
          stored: localStorage.getItem('wujie_user_settings') }));
        expect(state.fixture.toasts).toEqual([scenario.message]);
        expect(state.fixture.themeCalls).toBe(0);
        if (scenario.action === 'save') {
          expect(state.fixture.attempts).toHaveLength(1);
          expect(await page.getByRole('combobox', { name: '默认画质', exact: true }).inputValue()).toBe('ultra');
          const dirty = page.getByText('有未保存的修改', { exact: true });
          if (scenario.refuse) { expect(state.stored).toBeNull(); expect(await dirty.count()).toBe(1); }
          else { expect(JSON.parse(state.stored!).imageQuality).toBe('ultra'); expect(await dirty.count()).toBe(0); }
        }
        if (scenario.action === 'password') {
          const field = page.getByLabel('新密码', { exact: true });
          if (scenario.type === 'success') expect(await field.count()).toBe(0);
          else { expect(await field.count()).toBe(1); expect(await field.inputValue()).toBe(scenario.password); }
        }
      } finally {
        try {
          if (mounted && !page.isClosed()) await page.evaluate(() => (window as unknown as FixtureWindow).settingsFixture.dispose());
          await Promise.allSettled([...pending]);
        } finally { await context.close(); }
      }
      expect(errors).toEqual([]);
      expect(requests).toEqual(['GET /', ...(scenario.response ? ['POST /api/user/change-password'] : [])]);
    }, 20000);
  }
});
