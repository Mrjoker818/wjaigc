// @vitest-environment node
// Real React + shipped styles in Chromium. Only preset/model HTTP responses are
// fixtures. No generated panel DOM, replaced geometry, paid request or user data.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
interface VisibleViewport { width: number; height: number; left: number; top: number }
interface FixtureWindow extends Window {
  refineMobileFixture: {
    mount(theme: Theme): void;
    visual(view: VisibleViewport): void;
    state: { closes: number; adds: number; mounted: boolean };
  };
}
interface Session { context: BrowserContext; page: Page; requests: string[]; errors: string[] }

const ORIGIN = 'http://refine-mobile.invalid';
const THEMES: Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import RefineEnginePanel from '@/components/refine-engine-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={closes:0,adds:0,mounted:false};
const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0,scale:1});
Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
window.addEventListener('resize',()=>{
  Object.assign(viewport,{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0});
  viewport.dispatchEvent(new Event('resize'));
});
Object.assign(window,{refineMobileFixture:{state,
  mount(theme:'gold'|'mono'){
    if(state.mounted)throw Error('REFINE_REMOUNT_FORBIDDEN');state.mounted=true;
    document.documentElement.classList.toggle('dark',theme==='gold');
    document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
    root.render(<RefineEnginePanel isMonochrome={theme==='mono'} onClose={()=>{state.closes++;root.render(null)}}
      onAddImage={()=>state.adds++}/>);
  },
  visual(view:{width:number;height:number;left:number;top:number}){
    Object.assign(viewport,{width:view.width,height:view.height,offsetLeft:view.left,offsetTop:view.top});
    viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));
  }
}});
`;

let browser: Browser | undefined;
let css = '';
let bundle = '';
const live = new Set<Session>();

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const component = await readFile(path.resolve('src/components/refine-engine-panel.tsx'), 'utf8');
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: component, extension: 'tsx' }]));
  const output = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'refine-mobile-entry.tsx' } });
  bundle = output.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  const failures: string[] = [];
  for (const session of live) {
    try { await dispose(session); } catch (error) { failures.push(String(error)); }
  }
  try { await browser?.close(); } finally { browser = undefined; }
  if (failures.length) throw Error(failures.join('\n'));
}, 15000);

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function session(theme: Theme, width: number, height: number): Promise<Session> {
  if (!browser) throw Error('REFINE_BROWSER_MISSING');
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const value: Session = { context, page, requests: [], errors: [] };
  live.add(value);
  page.on('pageerror', error => value.errors.push(String(error)));
  await context.routeWebSocket('**/*', socket => {
    value.errors.push('REFINE_UNEXPECTED_WEBSOCKET');
    socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' });
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    value.requests.push(`${method} ${url.href}`);
    const headers = request.headers();
    try {
      if (url.origin !== ORIGIN || url.username || url.password || headers.authorization || headers['x-api-key']
        || headers['idempotency-key'] || value.requests.length > 3) throw Error('REFINE_REQUEST_BOUNDARY');
      if (method === 'GET' && url.href === ORIGIN + '/' && request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` });
      } else if (method === 'GET' && url.href === ORIGIN + '/api/refine-engine' && request.postData() === null) {
        await route.fulfill({ json: { success: true,
          categories: [{ id: 'default', name: '产品与品牌素材', material: '', reflectIndex: 0.4, renderFocus: '' }],
          lightings: [], viewAngles: [] } });
      } else if (method === 'POST' && url.href === ORIGIN + '/api/refine-engine'
        && headers['content-type'] === 'application/json' && request.postData() === '{"action":"models"}') {
        await route.fulfill({ json: { success: true, providers: [{ id: 'offline-refine', displayName: '离线供应商' }],
          models: [{ id: 'gpt-image-2', name: '离线图像模型', providerId: 'offline-refine' }] } });
      } else throw Error(`REFINE_UNEXPECTED_REQUEST:${method} ${url.href}`);
    } catch (error) { value.errors.push(String(error)); await route.abort(); }
  });
  await page.goto(ORIGIN);
  await page.addScriptTag({ content: bundle });
  const loaded = page.waitForResponse(response => response.url() === ORIGIN + '/api/refine-engine'
    && response.request().method() === 'POST');
  await page.evaluate(themeValue => (window as unknown as FixtureWindow).refineMobileFixture.mount(themeValue), theme);
  await loaded;
  await page.getByRole('button', { name: '标准模式', exact: true }).waitFor();
  await settle(page);
  return value;
}

async function dispose(value: Session): Promise<void> {
  await value.context.close();
  live.delete(value);
  if (value.errors.length) throw Error(`REFINE_FIXTURE_INFRASTRUCTURE: ${value.errors.join('; ')}`);
  if (!isDeepStrictEqual(value.requests, [`GET ${ORIGIN}/`, `GET ${ORIGIN}/api/refine-engine`, `POST ${ORIGIN}/api/refine-engine`]))
    throw Error(`REFINE_FIXTURE_REQUEST_SEQUENCE: ${JSON.stringify(value.requests)}`);
}

async function withSession(theme: Theme, width: number, height: number, operation: (value: Session) => Promise<void>): Promise<void> {
  const value = await session(theme, width, height);
  try { await operation(value); } finally { await dispose(value); }
}

function panel(value: Session): Locator { return value.page.locator('[data-floating-panel]'); }
function closeControl(value: Session): Locator { return panel(value).locator(':scope > div').first().getByRole('button'); }

async function target(value: Session, control: Locator, view: VisibleViewport): Promise<void> {
  expect(await value.page.evaluate(() => window.scrollX)).toBe(0);
  const rect = await control.boundingBox();
  expect(rect).not.toBeNull();
  if (!rect) throw Error('REFINE_MISSING_RECT');
  expect(rect.width, 'touch width').toBeGreaterThanOrEqual(44);
  expect(rect.height, 'touch height').toBeGreaterThanOrEqual(44);
  expect(rect.x).toBeGreaterThanOrEqual(view.left + 16);
  expect(rect.y).toBeGreaterThanOrEqual(view.top + 16);
  expect(rect.x + rect.width).toBeLessThanOrEqual(view.left + view.width - 16);
  expect(rect.y + rect.height).toBeLessThanOrEqual(view.top + view.height - 16);
  expect(await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const bounds = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)
        && (box.left < bounds.left + parent.clientLeft - 0.5 || box.right > bounds.left + parent.clientLeft + parent.clientWidth + 0.5)) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)
        && (box.top < bounds.top + parent.clientTop - 0.5 || box.bottom > bounds.top + parent.clientTop + parent.clientHeight + 0.5)) return false;
    }
    return true;
  }), 'whole control clear of ancestor clipping').toBe(true);
  expect(await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), 'native hit target').toBe(true);
}

async function nativeReveal(value: Session, control: Locator): Promise<void> {
  const scroller = panel(value).locator(':scope > .overflow-y-auto');
  for (let attempt = 0; attempt < 4; attempt++) {
    const clip = await scroller.boundingBox(), rect = await control.boundingBox();
    if (!clip || !rect) throw Error('REFINE_NATIVE_SCROLL_RECT_MISSING');
    expect(clip.height, 'native scroll area fits the control').toBeGreaterThanOrEqual(rect.height);
    if (rect.y >= clip.y && rect.y + rect.height <= clip.y + clip.height) return;
    await value.page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
    const delta = rect.y < clip.y ? Math.floor(rect.y - clip.y) : Math.ceil(rect.y + rect.height - clip.y - clip.height);
    await value.page.mouse.wheel(0, delta);
    await settle(value.page);
  }
  throw Error('REFINE_NATIVE_SCROLL_TARGET_UNREACHED');
}

async function checkHeader(value: Session, view: VisibleViewport): Promise<void> {
  await target(value, closeControl(value), view);
  expect(await closeControl(value).getAttribute('aria-label')).toBe('关闭精修引擎');
  const title = panel(value).getByText('精修引擎', { exact: true });
  const typography = await title.evaluate(element => ({ height: element.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight), clipped: element.scrollWidth > element.clientWidth + 1 }));
  expect(typography.height, 'horizontal title').toBeLessThanOrEqual(typography.lineHeight + 1);
  expect(typography.clipped, 'complete title visible').toBe(false);
  for (const name of ['标准模式', '专家模式', '上传图片', '精修设置', '精修结果'])
    await target(value, value.page.getByRole('button', { name, exact: true }), view);
  expect(await value.page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
}

describe('mobile refine layout', () => {
  const cases = THEMES.flatMap(theme => [[320, 640], [390, 844], [640, 320], [1440, 900]]
    .map(([width, height]) => ({ theme, width, height })));
  it.each(cases)('$theme $width x $height keeps named close and settings reachable', async ({ theme, width, height }) => {
    await withSession(theme, width, height, async value => {
      const view = { width, height, left: 0, top: 0 };
      await checkHeader(value, view);
      await value.page.getByRole('button', { name: '精修设置', exact: true }).click();
      await settle(value.page);
      const ratio = value.page.getByRole('button', { name: '1:1', exact: true });
      await nativeReveal(value, ratio); await target(value, ratio, view); await ratio.click();
      const quality = value.page.getByRole('button', { name: '中', exact: true });
      await nativeReveal(value, quality); await target(value, quality, view);
      expect(await value.page.getByRole('button', { name: '开始精修', exact: true }).isDisabled()).toBe(true);
      await closeControl(value).click();
      expect(await value.page.evaluate(() => (window as unknown as FixtureWindow).refineMobileFixture.state)).toEqual({ closes: 1, adds: 0, mounted: true });
    });
  }, 25000);

  it.each(THEMES)('%s follows the shortened visible viewport without remounting', async theme => {
    await withSession(theme, 390, 844, async value => {
      const view = { width: 370, height: 320, left: 10, top: 120 };
      await value.page.evaluate(next => (window as unknown as FixtureWindow).refineMobileFixture.visual(next), view);
      await settle(value.page);
      const rect = await panel(value).boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(26);
      expect(rect!.y).toBeGreaterThanOrEqual(136);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(364);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(424);
      await checkHeader(value, view);
      await closeControl(value).click();
    });
  }, 25000);

  it.each(THEMES)('%s retains expert mode through portrait and short landscape resize', async theme => {
    await withSession(theme, 390, 844, async value => {
      await value.page.getByRole('button', { name: '专家模式', exact: true }).click();
      for (const [width, height] of [[640, 320], [320, 640], [1440, 900]]) {
        await value.page.setViewportSize({ width, height }); await settle(value.page);
        await checkHeader(value, { width, height, left: 0, top: 0 });
        expect(await panel(value).textContent()).toContain('专家精修');
      }
      await closeControl(value).click();
    });
  }, 25000);
});

describe('mobile refine fixture boundary', () => {
  it.each(['http', 'websocket'] as const)('refuses %s and classifies it as infrastructure, not layout RED', async transport => {
    const value = await session('gold', 390, 844);
    try {
      if (transport === 'http') {
        const rejected = await value.page.evaluate(async () => {
          try { await fetch('/unexpected-request'); return false; } catch { return true; }
        });
        expect(rejected).toBe(true);
      } else {
        const code = await value.page.evaluate(() => new Promise<number>((resolve, reject) => {
          const socket = new WebSocket('ws://unexpected.invalid/forbidden');
          const timer = setTimeout(() => reject(Error('REFINE_WS_REFUSAL_NOT_OBSERVED')), 3000);
          socket.onclose = event => { clearTimeout(timer); resolve(event.code); };
        }));
        expect(code).toBe(1008);
      }
      let failure: unknown;
      try { await dispose(value); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).name).toBe('Error');
      expect((failure as Error).message).toMatch(/^REFINE_FIXTURE_INFRASTRUCTURE:/);
    } finally {
      if (live.has(value)) { await value.context.close(); live.delete(value); }
    }
  }, 25000);
});
