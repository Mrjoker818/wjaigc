// @vitest-environment node
// Real ProjectDataPanel and styles; all network and product actions are blocked.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://project-data-reading.invalid';
const DESCRIPTION = '开始标记' + '连续文字没有空格用于验证长内容在窄屏中自动换行'.repeat(8)
  + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(5)
  + '\n' + '第二段连续文字也需要逐行通过滚动完整阅读'.repeat(5) + '结束标记';
const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectDataPanel } from '@/components/project-data-panel';
const root = createRoot(document.getElementById('fixture-root')!);
const state = { close: 0, navigate: 0, remove: 0, same: 0 };
function forbidden(name: keyof typeof state) { state[name]++; throw new Error('FORBIDDEN_' + name); }
Object.assign(window, { readingFixture: {
  mount(description: string) {
    const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"%3E%3Crect width="16" height="16" fill="%23990"/%3E%3C/svg%3E';
    root.render(<ProjectDataPanel isOpen={true} projectName="合成项目" projectDescription="合成说明"
      images={[{ id:'synthetic-image', url:image, x:0, y:0, width:16, height:16, prompt:description, createdAt:1 }]}
      isMonochrome={false} onClose={() => forbidden('close')} onDeleteImages={() => forbidden('remove')}
      onNavigateToImage={() => forbidden('navigate')} onMakeSame={() => forbidden('same')} />);
  },
  state, unmount() { root.unmount(); },
} });
`;

interface FixtureWindow extends Window {
  readingFixture: { mount(description: string): void; unmount(): void; state: Record<string, number> };
}
interface TextSnapshot {
  text: string;
  lineCount: number;
  explicitBreak: boolean;
  lineClamp: string;
  whiteSpace: string;
  overflowWrap: string;
  clientWidth: number;
  scrollWidth: number;
  clientHeight: number;
  scrollHeight: number;
  visible: number[];
  rendered: number[];
}

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile(path.resolve('src/components/project-data-panel.tsx'), 'utf8');
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
    { content: source, extension: 'tsx' }, { content: ENTRY, extension: 'tsx' },
  ]));
  const result = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'project-data-reading-entry.tsx' } });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
}, 30000);

afterAll(async () => { await browser?.close(); browser = undefined; }, 15000);

async function textSnapshot(text: Locator): Promise<TextSnapshot> {
  return text.evaluate(element => {
    const style = getComputedStyle(element), contents = element.textContent || '';
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const s = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(s.overflowX)) {
        left = Math.max(left, rect.left + parent.clientLeft);
        right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
      }
      if (/hidden|clip|auto|scroll/.test(s.overflowY)) {
        top = Math.max(top, rect.top + parent.clientTop);
        bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
      }
    }
    const visible: number[] = [], rendered: number[] = [], linePositions: number[] = [], charTops: number[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null, offset = 0;
    while ((node = walker.nextNode())) {
      const value = node.textContent || '';
      for (let index = 0; index < value.length; index++) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width < 0.01 || rect.height < 0.01) continue;
        rendered.push(offset + index);
        charTops[offset + index] = rect.top;
        if (!linePositions.some(y => Math.abs(y - rect.top) < 0.5)) linePositions.push(rect.top);
        const within = rect.left >= left - 0.5 && rect.right <= right + 0.5 && rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5;
        const hit = within ? document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2) : null;
        if (hit && (hit === element || element.contains(hit))) visible.push(offset + index);
      }
      offset += value.length;
    }
    const newline = contents.indexOf('\n');
    return { text: contents, lineCount: linePositions.length,
      explicitBreak: newline > 0 && charTops[newline + 1] > charTops[newline - 1], lineClamp: style.webkitLineClamp,
      whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, visible, rendered };
  });
}

describe('project data long descriptions on mobile', () => {
  for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 320 }]) {
    for (const mode of ['grid', 'list'] as const) {
      it(`${viewport.width}x${viewport.height} ${mode}: wraps and reveals the complete description by touch scrolling`, async () => {
        if (!browser) throw Error('BROWSER_NOT_STARTED');
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
          serviceWorkers: 'block', reducedMotion: 'reduce' });
        const requests: string[] = [], errors: string[] = [];
        const page = await context.newPage();
        page.setDefaultTimeout(4000);
        page.on('pageerror', error => errors.push('PAGE ' + error.message));
        await context.routeWebSocket('**/*', socket => { errors.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url()), headers = request.headers();
          const key = `${request.method()} ${url.pathname}${url.search}`;
          requests.push(key);
          if (url.origin === ORIGIN && key === 'GET /' && request.postData() === null
            && !headers.cookie && !headers.authorization && !headers['x-api-key']) {
            await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` });
            return;
          }
          errors.push('FORBIDDEN ' + key);
          await route.abort('blockedbyclient');
        });

        let mounted = false;
        try {
          await page.goto(ORIGIN + '/');
          await page.addScriptTag({ content: bundle });
          await page.evaluate(description => (window as unknown as FixtureWindow).readingFixture.mount(description), DESCRIPTION);
          mounted = true;
          const panel = page.locator('[data-popup="project-data"]');
          await panel.waitFor();
          if (mode === 'list') {
            await panel.getByTitle('列表模式', { exact: true }).tap();
            await panel.getByTitle('大图模式', { exact: true }).waitFor();
          }
          const body = panel.locator('div.min-h-0.flex-1.overflow-y-auto').first();
          const description = panel.getByText(DESCRIPTION, { exact: true });
          await description.waitFor({ state: 'attached' });
          const first = await textSnapshot(description);
          expect(first.text).toBe(DESCRIPTION);
          expect(first.lineCount).toBeGreaterThan(2);
          expect(first.explicitBreak).toBe(true);
          expect(first.lineClamp).toBe('none');
          expect(first.whiteSpace).toBe('pre-wrap');
          expect(first.overflowWrap).toBe('break-word');
          expect(first.scrollWidth).toBeLessThanOrEqual(first.clientWidth + 1);
          expect(first.scrollHeight).toBeLessThanOrEqual(first.clientHeight + 1);
          const required = Array.from(DESCRIPTION, (_, index) => index).filter(index => DESCRIPTION[index] !== '\n');
          expect(first.rendered).toEqual(required);
          const seen = new Set(first.visible);
          const cdp = await context.newCDPSession(page);
          let steps = 0, previous = -1;
          try {
            while (steps < 45) {
              const metrics = await body.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight,
                  x: rect.left + 5, y: rect.top, height: rect.height };
              });
              if (metrics.top >= metrics.max - 1) break;
              expect(metrics.top).toBeGreaterThan(previous);
              previous = metrics.top;
              const distance = Math.min(65, metrics.height - 18), x = metrics.x;
              expect(distance).toBeGreaterThan(8);
              const start = metrics.y + metrics.height / 2 + distance / 2, end = start - distance;
              const safe = await page.evaluate(({ x, y }) => {
                const hit = document.elementFromPoint(x, y);
                const body = document.querySelector('[data-popup="project-data"] .min-h-0.flex-1.overflow-y-auto');
                let nearest = hit;
                while (nearest) {
                  const style = getComputedStyle(nearest);
                  if (/auto|scroll/.test(style.overflowY) && nearest.scrollHeight > nearest.clientHeight + 1) break;
                  nearest = nearest.parentElement;
                }
                return Boolean(hit && !hit.closest('button,input,a,textarea,select') && nearest === body);
              }, { x, y: start });
              expect(safe).toBe(true);
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
              for (let step = 1; step <= 8; step++) {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * step / 8 }] });
                await page.waitForTimeout(18);
              }
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
              await page.waitForTimeout(140);
              for (const index of (await textSnapshot(description)).visible) seen.add(index);
              steps++;
            }
          } finally { await cdp.detach(); }
          const finalPosition = await body.evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
          expect(steps).toBeGreaterThan(0);
          expect(finalPosition.top).toBeGreaterThanOrEqual(finalPosition.max - 1);
          expect([...seen].sort((a, b) => a - b)).toEqual(required);
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
          expect(await page.evaluate(() => (window as unknown as FixtureWindow).readingFixture.state))
            .toEqual({ close: 0, navigate: 0, remove: 0, same: 0 });
        } finally {
          try {
            if (mounted && !page.isClosed()) await page.evaluate(() => (window as unknown as FixtureWindow).readingFixture.unmount());
          } finally { await context.close(); }
        }
        expect(errors).toEqual([]);
        expect(requests).toEqual(['GET /']);
      }, 30000);
    }
  }
});
