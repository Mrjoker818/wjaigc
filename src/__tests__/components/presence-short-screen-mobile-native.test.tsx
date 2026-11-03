// @vitest-environment node
// Real component and project styles; no collaboration server or member mutations.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://presence-layout.invalid';
const PROJECT_ID = 'synthetic-project';
const MEMBERS = Array.from({ length: 12 }, (_, index) => ({
  userId: `synthetic-${index + 1}`,
  name: `合成成员${String(index + 1).padStart(2, '0')}`,
}));
const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PresenceIndicator } from '@/components/collaboration/presence-indicator';
const root = createRoot(document.getElementById('fixture-root')!);
Object.assign(window, { presenceFixture: {
  mount(theme: 'gold' | 'monochrome') {
    root.render(<PresenceIndicator projectId="synthetic-project" isOwner={true} themeStyle={theme} />);
  },
  unmount() { root.unmount(); },
} });
`;

interface FixtureWindow extends Window {
  presenceFixture: { mount(theme: 'gold' | 'monochrome'): void; unmount(): void };
  closeEvents: Array<{ type: string; trusted: boolean }>;
}

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile(path.resolve('src/components/collaboration/presence-indicator.tsx'), 'utf8');
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([
    { content: source, extension: 'tsx' },
    { content: ENTRY, extension: 'tsx' },
  ]));
  const result = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'presence-layout-entry.tsx' },
    plugins: [{
      name: 'synthetic-presence-status',
      setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/collaboration\/presence-client$/ }, () => ({ path: 'status', namespace: 'synthetic' }));
        builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({
          contents: 'export function useProjectPresence(){return {status:"online",participants:[{userId:"synthetic-online",displayName:"合成用户"}]}}',
          loader: 'js',
        }));
      },
    }],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
}, 30000);

afterAll(async () => { await browser?.close(); browser = undefined; }, 15000);

async function geometry(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        left = Math.max(left, rect.left + parent.clientLeft);
        right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        top = Math.max(top, rect.top + parent.clientTop);
        bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
      }
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      width: box.width, height: box.height,
      inside: box.left >= left - 0.5 && box.right <= right + 0.5 && box.top >= top - 0.5 && box.bottom <= bottom + 0.5,
      hit: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
}

describe('online members panel on mobile viewports', () => {
  for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 320 }]) {
    for (const theme of ['gold', 'monochrome'] as const) {
      it(`${viewport.width}x${viewport.height} ${theme}: closes independently and scrolls to the last member`, async () => {
        if (!browser) throw Error('BROWSER_NOT_STARTED');
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
        const requests: string[] = [], errors: string[] = [];
        const page = await context.newPage();
        page.setDefaultTimeout(4000);
        page.on('pageerror', error => errors.push('PAGE ' + error.message));
        await context.routeWebSocket('**/*', socket => { errors.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url()), headers = request.headers();
          const key = `${request.method()} ${url.pathname}${url.search}`;
          requests.push(key);
          if (url.origin !== ORIGIN || request.method() !== 'GET' || request.postData() !== null
            || headers.cookie || headers.authorization || headers['x-api-key']) {
            errors.push('FORBIDDEN ' + key);
            await route.abort('blockedbyclient');
            return;
          }
          if (key === 'GET /') {
            await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` });
          } else if (key === `GET /api/collaboration/members?projectId=${PROJECT_ID}`) {
            await route.fulfill({ json: { members: MEMBERS } });
          } else {
            errors.push('UNEXPECTED ' + key);
            await route.abort('blockedbyclient');
          }
        });

        let mounted = false;
        try {
          await page.goto(ORIGIN + '/');
          await page.addScriptTag({ content: bundle });
          await page.evaluate(selected => (window as unknown as FixtureWindow).presenceFixture.mount(selected), theme);
          mounted = true;
          const open = page.getByRole('button', { name: '管理在线成员', exact: true });
          await open.tap();
          const dialog = page.getByRole('dialog', { name: '项目在线成员', exact: true });
          await dialog.waitFor();
          await page.getByText('合成成员01', { exact: true }).waitFor();
          expect((await geometry(dialog)).inside).toBe(true);
          const close = page.getByRole('button', { name: '关闭在线成员面板', exact: true });
          expect(await geometry(close)).toMatchObject({ width: 44, height: 44, inside: true, hit: true });

          // A tap is successful only if the browser delivers a real click and React closes the dialog.
          await page.evaluate(() => {
            const fixture = window as unknown as FixtureWindow;
            fixture.closeEvents = [];
            for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) {
              document.addEventListener(type, event => {
                if ((event.target as Element | null)?.closest?.('button')?.getAttribute('aria-label') === '关闭在线成员面板') {
                  fixture.closeEvents.push({ type, trusted: event.isTrusted });
                }
              }, true);
            }
          });
          await close.tap();
          await dialog.waitFor({ state: 'detached' });
          expect(await page.evaluate(() => (window as unknown as FixtureWindow).closeEvents)).toContainEqual({ type: 'click', trusted: true });

          // Reopen for the scrolling check, so its result cannot mask an undelivered close click.
          await open.tap();
          await dialog.waitFor();
          await page.getByText('合成成员12', { exact: true }).waitFor({ state: 'attached' });
          const list = page.getByRole('list', { name: '已邀请成员', exact: true });
          const short = viewport.height <= 400;
          const scrollContainer = short ? dialog : list;
          const scrollStyles = await dialog.evaluate(element => {
            const listElement = element.querySelector('ul');
            if (!listElement) throw Error('LIST_MISSING');
            return { dialog: getComputedStyle(element).overflowY, list: getComputedStyle(listElement).overflowY };
          });
          if (short) expect(scrollStyles).toEqual({ dialog: 'auto', list: 'visible' });
          else expect(scrollStyles.list).toBe('auto');

          const metrics = () => scrollContainer.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { top: element.scrollTop, client: element.clientHeight, total: element.scrollHeight,
              x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom };
          });
          let position = await metrics();
          expect(position.total).toBeGreaterThan(position.client);
          const initialTop = position.top;
          const cdp = await context.newCDPSession(page);
          try {
            for (let count = 0; count < 6 && position.top + position.client < position.total - 2; count++) {
              const x = Math.round(position.x + 20), start = Math.floor(Math.min(viewport.height - 3, position.bottom - 3));
              const end = Math.ceil(Math.max(3, position.y + 3));
              expect(start).toBeGreaterThan(end + 5);
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
              for (let step = 1; step <= 8; step++) {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * step / 8 }] });
                await page.waitForTimeout(20);
              }
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
              await page.waitForTimeout(250);
              position = await metrics();
            }
          } finally { await cdp.detach(); }
          expect(position.top).toBeGreaterThan(initialTop);
          expect(position.top + position.client).toBeGreaterThanOrEqual(position.total - 2);
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
          if (short) expect(await list.evaluate(element => element.scrollTop)).toBe(0);
          expect(await geometry(page.getByText('合成成员12', { exact: true }))).toMatchObject({ inside: true, hit: true });
          const revoke = await geometry(page.getByRole('button', { name: '撤销合成成员12的在线资格', exact: true }));
          expect(revoke.width).toBeGreaterThanOrEqual(44);
          expect(revoke.height).toBeGreaterThanOrEqual(44);
          expect(revoke).toMatchObject({ inside: true, hit: true });
        } finally {
          try {
            if (mounted && !page.isClosed()) await page.evaluate(() => (window as unknown as FixtureWindow).presenceFixture.unmount());
          } finally { await context.close(); }
        }
        expect(errors).toEqual([]);
        expect(requests).toEqual(['GET /', `GET /api/collaboration/members?projectId=${PROJECT_ID}`, `GET /api/collaboration/members?projectId=${PROJECT_ID}`]);
      }, 25000);
    }
  }
});
