// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A real ChatPanel bundle, based on chat-compact-rotation-focus-native.test.tsx.
// Only the .invalid fixture and its enumerated responses are allowed; the chat
// request is intercepted in the page and never sent over the network.
const root = process.cwd();
const projectRequire = createRequire(path.join(root, 'package.json'));
const origin = 'https://chat-tune-regression.invalid';
const draft = '合成草稿，保留两张参考图';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ChatPanel } from '@/components/chat-panel';
  const root = createRoot(document.getElementById('root')!);
  root.render(<div style={{height:'100dvh',width:window.__tunePanelWidth + 'px'}}>
    <ChatPanel themeStyle={window.__tuneTheme} projectId="synthetic-project" canvasImages={[]} chatTabOpen />
  </div>);
  Object.assign(window, { tuneUnmount: () => root.unmount() });
`;

type Theme = 'gold' | 'monochrome';
let bundle = '';
let css = '';
let browser: Browser;

beforeAll(async () => {
  const { build } = projectRequire('esbuild') as typeof import('esbuild');
  const result = await build({
    write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: root, tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', __dirname: '"/"' },
    inject: ['tune-test-next-process'],
    plugins: [{ name: 'tune-test-next-process', setup(builder) {
      builder.onResolve({ filter: /^tune-test-next-process$/ }, () => ({ path: 'process', namespace: 'tune-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'tune-test' }, () => ({
        contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: root,
      }));
    } }],
    stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: 'chat-tune-fixture.tsx' },
  });
  bundle = result.outputFiles[0].text;
  const files = Object.keys(result.metafile.inputs).filter(file => /^src[\\/].*\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({
    content: await readFile(path.resolve(root, file), 'utf8'), extension: path.extname(file).slice(1),
  })));
  const compiler = await compile(await readFile(path.join(root, 'src/app/globals.css'), 'utf8'), {
    base: root,
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? projectRequire.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.join(root, 'node_modules/tw-animate-css/dist/tw-animate.css')
          : projectRequire.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: entry, extension: 'tsx' }, ...sources]));
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
}, 45000);

afterAll(async () => { await browser?.close(); });

async function fixture(theme: Theme, panelWidth: number, desktop = false, opts?: { width: number; height: number; normalMotion?: boolean }): Promise<{
  page: Page; context: BrowserContext; faults: string[];
}> {
  const context = await browser.newContext({ viewport: opts ? { width: opts.width, height: opts.height } : desktop ? { width: 1024, height: 768 } : { width: 640, height: 320 },
    isMobile: !desktop, hasTouch: !desktop, reducedMotion: opts?.normalMotion ? 'no-preference' : 'reduce', serviceWorkers: 'block', acceptDownloads: false });
  const faults: string[] = [];
  await context.routeWebSocket('**/*', socket => { faults.push('unexpected websocket'); socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const safe = url.origin === origin && request.method() === 'GET' && !request.postData()
      && !headers.authorization && !headers.cookie && !headers['x-api-key'];
    if (safe && url.pathname === '/' && !url.search) {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head>'
        + '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">'
        + '<style>' + css + '</style></head><body><div id="root"></div></body></html>' });
    } else if (safe && url.pathname === '/api/skills' && url.search === '?surface=canvas') {
      await route.fulfill({ json: { skills: [] } });
    } else if (safe && url.pathname === '/api/chat-tasks'
      && url.search === '?projectId=synthetic-project&sessionId=synth') {
      await route.fulfill({ json: { success: true, tasks: [] } });
    } else if (safe && url.pathname === '/api/models'
      && ['?type=chat', '?type=image', '?type=vlm', '?type=video'].includes(url.search)) {
      await route.fulfill({ json: { models: url.search === '?type=chat'
        ? [{ id: 'chat', providerId: 'demo', name: '合成模型', isDefault: true }] : [],
      providers: [{ id: 'demo', name: '合成' }] } });
    } else {
      faults.push(`unexpected request: ${request.method()} ${url.origin}${url.pathname}${url.search}`);
      await route.abort('blockedbyclient');
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => faults.push(`page error: ${error.message}`));
  page.on('download', download => { faults.push('unexpected download'); void download.cancel(); });
  page.on('dialog', dialog => { faults.push('unexpected dialog'); void dialog.dismiss(); });
  await page.addInitScript(() => {
    localStorage.setItem('chat-sessions', JSON.stringify([{ id: 'synth', title: '合成历史', model: 'demo::chat',
      systemPrompt: '', createdAt: 1, updatedAt: 2, messages: Array.from({ length: 8 }, (_, i) => ({
        id: `tune-history-${i}`, role: 'user', content: `合成消息 ${i} ${'阅读内容 '.repeat(8)}`, timestamp: 100 + i,
      })) }]));
    const nativeFetch = window.fetch.bind(window);
    const bridge: { bodies: unknown[]; aborted: number } = { bodies: [], aborted: 0 };
    Object.assign(window, { tuneFixture: bridge });
    window.fetch = (request, init) => {
      const url = new URL(request instanceof Request ? request.url : String(request), location.href);
      const method = init?.method || (request instanceof Request ? request.method : 'GET');
      if (url.origin === location.origin && url.pathname === '/api/chat' && !url.search && method === 'POST') {
        if (bridge.bodies.length >= 2) throw new Error('unexpected extra chat request');
        if (typeof init?.body !== 'string' || !init.signal) throw new Error('unexpected synthetic chat request');
        const signal = init.signal;
        bridge.bodies.push(JSON.parse(init.body));
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => { bridge.aborted++; reject(new DOMException('aborted', 'AbortError')); };
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
        });
      }
      return nativeFetch(request, init);
    };
  });
  await page.goto(`${origin}/`);
  await page.evaluate(({ theme: value, width }) => {
    Object.assign(window, { __tuneTheme: value, __tunePanelWidth: width });
    document.documentElement.classList.toggle('dark', value === 'gold');
    document.documentElement.classList.toggle('theme-monochrome', value === 'monochrome');
  }, { theme, width: panelWidth });
  await page.addScriptTag({ content: bundle });
  return { page, context, faults };
}

async function tapVisible(page: Page, locator: Locator, requireTouchTarget = false): Promise<void> {
  // Check before tapping: locator.click()/tap() can silently scroll an offscreen button into view.
  const geometry = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
    const owns = (px: number, py: number) => {
      const hit = document.elementFromPoint(px, py);
      return !!hit && (hit === element || element.contains(hit));
    };
    return { width: rect.width, height: rect.height, visibleWidth: Math.max(0, right - left),
      visibleHeight: Math.max(0, bottom - top), x, y, centerHit: owns(x, y),
      // Sample all four axes near the boundary as rounded 44px controls need not own their corners.
      touch44: [[-21, 0], [21, 0], [0, -21], [0, 21]].every(([dx, dy]) => owns(x + dx, y + dy)) };
  });
  expect(geometry.visibleWidth).toBeGreaterThanOrEqual(geometry.width - 1);
  expect(geometry.visibleHeight).toBeGreaterThanOrEqual(geometry.height - 1);
  expect(geometry.centerHit).toBe(true);
  if (requireTouchTarget) expect(geometry.touch44).toBe(true);
  await page.touchscreen.tap(geometry.x, geometry.y);
}

async function closeFixture(page: Page, context: BrowserContext): Promise<void> {
  try { await page.evaluate(() => (window as unknown as { tuneUnmount: () => void }).tuneUnmount()); }
  finally { await context.close(); }
}

describe('ChatPanel short-screen Tune and narrow composer', () => {
  it.each<readonly [Theme, number]>([
    ['gold', 320], ['monochrome', 320], ['gold', 436], ['monochrome', 436],
  ])('%s %ipx keeps Tune, messages, draft, references and send/stop usable', async (theme, width) => {
    const { page, context, faults } = await fixture(theme, width);
    try {
      const input = page.locator('textarea').last();
      await input.waitFor();
      await page.getByText(/合成消息 7/).waitFor();
      await input.fill(draft);
      await page.locator('input[type=file][accept="image/*"]').setInputFiles([0, 1].map(i => ({
        name: `Tune${i}.png`, mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from([i])]),
      })));
      const refs = page.getByText('2张图片引用', { exact: true });
      await refs.waitFor();
      const images = refs.locator('xpath=../..').locator('div.group img');
      const originalSources = await images.evaluateAll(elements => elements.map(element => element.getAttribute('src')));
      expect(originalSources).toHaveLength(2);
      expect(originalSources[0]).not.toBe(originalSources[1]);

      const list = page.locator('[class*="overscroll-contain"][class*="space-y-3"]').first();
      const send = page.getByTitle('发送 (Enter)');
      await send.waitFor();
      await page.getByTitle('Tune 精细调节').click();
      await page.getByText('打开调节面板', { exact: true }).click();
      const back = page.getByRole('button', { name: '返回消息', exact: true });
      await back.waitFor({ state: 'visible' });
      expect(await list.evaluate(element => getComputedStyle(element).visibility)).toBe('hidden');
      const sliders = page.getByRole('slider');
      expect(await sliders.count()).toBe(4);
      const changed: string[] = [];
      for (let index = 0; index < 4; index++) {
        const slider = sliders.nth(index);
        await slider.scrollIntoViewIfNeeded();
        const before = Number(await slider.inputValue());
        await slider.focus();
        await slider.press('ArrowRight');
        expect(Number(await slider.inputValue())).toBe(before + 1);
        changed.push(await slider.inputValue());
      }
      // The return control is in the same scrollable panel as the sliders.
      await back.scrollIntoViewIfNeeded();
      await tapVisible(page, back);
      await back.waitFor({ state: 'hidden' });
      expect(await list.evaluate(element => getComputedStyle(element).visibility)).toBe('visible');
      await list.evaluate(element => { element.scrollTop = 0; });
      const message = page.getByText(/合成消息 0/).first();
      expect((await message.boundingBox())?.width).toBeGreaterThanOrEqual(200);
      expect(await input.inputValue()).toBe(draft);
      expect(await images.evaluateAll(elements => elements.map(element => element.getAttribute('src')))).toEqual(originalSources);

      await page.getByTitle('Tune 精细调节').click();
      await page.getByText('打开调节面板', { exact: true }).click();
      await back.waitFor({ state: 'visible' });
      expect(await sliders.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(changed);
      await back.scrollIntoViewIfNeeded();
      await tapVisible(page, back);
      await back.waitFor({ state: 'hidden' });
      await tapVisible(page, send, true);
      const stop = page.getByTitle('停止生成');
      await stop.waitFor({ state: 'visible' });
      const body = await page.evaluate(() => (window as unknown as { tuneFixture: { bodies: unknown[] } }).tuneFixture.bodies);
      expect(body).toHaveLength(1);
      const wire = JSON.stringify(body[0]);
      expect(wire).toContain(draft);
      expect(wire).toContain('【精细调节参数】');
      expect(wire).toContain('修改强度: 71');
      for (const source of originalSources) expect(wire).toContain(source);
      await tapVisible(page, stop, true);
      await stop.waitFor({ state: 'detached' });
      expect(await page.evaluate(() => (window as unknown as { tuneFixture: { aborted: number } }).tuneFixture.aborted)).toBe(1);
      await page.getByTitle('Tune 精细调节').click();
      await page.getByText('关闭调节', { exact: true }).click();
      await input.fill('关闭调节后的合成草稿');
      await tapVisible(page, send, true);
      await stop.waitFor({ state: 'visible' });
      const afterClose = await page.evaluate(() => (window as unknown as { tuneFixture: { bodies: unknown[] } }).tuneFixture.bodies);
      expect(afterClose).toHaveLength(2);
      expect(JSON.stringify(afterClose[1])).not.toContain('【精细调节参数】');
      await tapVisible(page, stop, true);
      await stop.waitFor({ state: 'detached' });
      expect(await page.evaluate(() => (window as unknown as { tuneFixture: { aborted: number } }).tuneFixture.aborted)).toBe(2);
    } finally { await closeFixture(page, context); }
    expect(faults).toEqual([]);
  }, 30000);

  it('keeps the desktop Tune panel inline and closes it when the composer is clicked', async () => {
    const { page, context, faults } = await fixture('gold', 1024, true);
    try {
      const input = page.locator('textarea').last();
      await input.waitFor();
      await input.fill(draft);
      await page.getByTitle('Tune 精细调节').click();
      await page.getByText('打开调节面板', { exact: true }).click();
      // The closing modal menu can briefly hide the background from accessibility queries.
      await expect.poll(() => page.locator('#root').getAttribute('aria-hidden')).toBeNull();
      const sliders = page.getByRole('slider');
      expect(await sliders.count()).toBe(4);
      expect(await page.getByRole('button', { name: '返回消息' }).isVisible()).toBe(false);
      expect(await page.locator('[class*="overscroll-contain"][class*="space-y-3"]').first()
        .evaluate(element => getComputedStyle(element).visibility)).toBe('visible');
      await input.click();
      expect(await sliders.count()).toBe(0);
      expect(await input.inputValue()).toBe(draft);
    } finally { await closeFixture(page, context); }
    expect(faults).toEqual([]);
  }, 30000);
});

describe('ChatPanel Tune keyboard and reference touch boundaries', () => {
  it.each<readonly [Theme, number]>([
    ['gold', 400], ['monochrome', 400], ['gold', 401],
    ['monochrome', 401], ['gold', 768], ['monochrome', 768],
  ])('%s 1024x%i restores focus and exposes all sliders with normal motion', async (theme, height) => {
    const { page, context, faults } = await fixture(theme, 1024, true, {
      width: 1024, height, normalMotion: true,
    });
    try {
      const input = page.locator('textarea').last();
      await input.waitFor();
      await input.fill(draft);
      const trigger = page.getByTitle('Tune 精细调节');
      await trigger.click();
      await page.getByText('打开调节面板', { exact: true }).click();
      await expect.poll(() => page.locator('#root').getAttribute('aria-hidden'), { timeout: 3000 }).toBeNull();
      const sliders = page.getByRole('slider');
      expect(await sliders.count()).toBe(4);
      expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true);

      const seen = new Set<number>();
      for (let step = 0; step < 60 && seen.size < 4; step++) {
        await page.keyboard.press('Tab');
        const index = await page.evaluate(() =>
          Array.from(document.querySelectorAll('input[type=range]')).indexOf(document.activeElement as HTMLInputElement),
        );
        if (index < 0 || seen.has(index)) continue;
        const active = page.locator('input[type=range]:focus');
        const visible = await active.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
            && rect.right > 0 && rect.left < innerWidth && style.visibility === 'visible';
        });
        expect(visible).toBe(true);
        const before = Number(await active.inputValue());
        await page.keyboard.press('ArrowRight');
        expect(Number(await active.inputValue())).toBe(before + 1);
        seen.add(index);
      }
      expect(seen.size).toBe(4);
      if (height <= 400) {
        const back = page.getByRole('button', { name: '返回消息', exact: true });
        await back.scrollIntoViewIfNeeded();
        await back.click();
      } else {
        await input.click();
      }
      await expect.poll(() => sliders.count()).toBe(0);
      expect(await input.inputValue()).toBe(draft);
    } finally {
      await closeFixture(page, context);
    }
    expect(faults).toEqual([]);
  }, 30000);

  it.each<readonly [Theme, number]>([
    ['gold', 320], ['monochrome', 436],
  ])('%s %ipx touch removes one reference and focuses the composer', async (theme, width) => {
    const { page, context, faults } = await fixture(theme, width, false, {
      width: 640, height: 320, normalMotion: true,
    });
    try {
      const input = page.locator('textarea').last();
      await input.waitFor();
      await input.fill(draft);
      await page.locator('input[type=file][accept="image/*"]').setInputFiles([0, 1].map(index => ({
        name: 'Tune' + index + '.png', mimeType: 'image/png',
        buffer: Buffer.concat([png, Buffer.from([index])]),
      })));
      await page.getByText('2张图片引用', { exact: true }).waitFor();
      const remove = page.getByRole('button', { name: '移除第1张参考图 Tune0.png', exact: true });
      await tapVisible(page, remove, true);
      await page.getByText('1张图片引用', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '移除第1张参考图 Tune1.png', exact: true }).count()).toBe(1);
      expect(await input.inputValue()).toBe(draft);
      await tapVisible(page, input);
      expect(await input.evaluate(element => document.activeElement === element)).toBe(true);
      await page.keyboard.insertText('续写');
      expect(await input.inputValue()).toContain('续写');
    } finally {
      await closeFixture(page, context);
    }
    expect(faults).toEqual([]);
  }, 30000);
});

describe('ChatPanel short-screen actual touch slider operation', () => {
  it.each<readonly [Theme, number]>([['gold', 320], ['monochrome', 436]])('%s %ipx adjusts all four sliders by touch', async (theme, width) => {
    const { page, context, faults } = await fixture(theme, width, false, { width: 640, height: 320, normalMotion: true });
    try {
      const input = page.locator('textarea').last();
      await input.waitFor();
      await input.fill(draft);
      await page.locator('input[type=file][accept="image/*"]').setInputFiles([0, 1].map(index => ({ name: 'Tune' + index + '.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from([index])]) })));
      await page.getByText('2张图片引用', { exact: true }).waitFor();
      await page.getByTitle('Tune 精细调节').click();
      await page.getByText('打开调节面板', { exact: true }).click();
      const back = page.getByRole('button', { name: '返回消息', exact: true });
      await back.waitFor({state:'visible'});
      const sliders = page.getByRole('slider');
      expect(await sliders.count()).toBe(4);
      for (let index = 0; index < 4; index++) {
        const slider = sliders.nth(index);
        await slider.scrollIntoViewIfNeeded();
        const before = Number(await slider.inputValue());
        const box = await slider.boundingBox();
        if (!box) throw Error('touch slider has no bounds');
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        const x=box.x+box.width*0.85, y=box.y+box.height/2;
        const hit = await slider.evaluate((element, point) => document.elementFromPoint(point.x,point.y) === element, {x,y});
        expect(hit, 'touch target remains visible and hit-testable').toBe(true);
        await page.touchscreen.tap(x,y);
        await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(before);
      }
      await back.scrollIntoViewIfNeeded();
      await tapVisible(page,back,true);
      await back.waitFor({state:'hidden'});
      expect(await input.inputValue()).toBe(draft);
      expect(await page.getByText('2张图片引用',{exact:true}).count()).toBe(1);
    } finally { await closeFixture(page,context); }
    expect(faults).toEqual([]);
  },30000);
});
