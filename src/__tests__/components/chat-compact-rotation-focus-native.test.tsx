// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const requireFromProject = createRequire(path.join(root, 'package.json'));
const origin = 'https://chat-rotation-regression.invalid';
const draft = '横竖屏切换保留合成草稿';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ChatPanel } from '@/components/chat-panel';
  const root = createRoot(document.getElementById('root')!);
  function Fixture() {
    const [externalPrompt, setExternalPrompt] = React.useState<string | undefined>();
    React.useEffect(() => { Object.assign(window, { rotationInjectPrompt: setExternalPrompt }); }, []);
    const consumed = React.useCallback(() => setExternalPrompt(undefined), []);
    return <div style={{height:'100dvh',width:'100vw'}}>
      <ChatPanel themeStyle={window.__rotationTheme} projectId="synthetic-project" canvasImages={[]} chatTabOpen
        externalPrompt={externalPrompt} onExternalPromptConsumed={consumed} />
    </div>;
  }
  root.render(<Fixture />);
  Object.assign(window, { rotationFixtureUnmount: () => root.unmount() });
`;

type Theme = 'gold' | 'monochrome';
type Menu = 'model' | 'agent';
let bundle = '';
let css = '';
let browser: Browser;

beforeAll(async () => {
  const { build } = requireFromProject('esbuild') as typeof import('esbuild');
  const result = await build({
    write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: root, tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', __dirname: '"/"' },
    inject: ['rotation-test-next-process'],
    plugins: [{
      name: 'rotation-test-next-process',
      setup(builder) {
        builder.onResolve({ filter: /^rotation-test-next-process$/ }, () => ({ path: 'process', namespace: 'rotation-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'rotation-test' }, () => ({
          contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: root,
        }));
      },
    }],
    stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: 'chat-rotation-entry.tsx' },
  });
  bundle = result.outputFiles[0].text;
  const projectInputs = Object.keys(result.metafile.inputs)
    .filter(file => /^src[\\/].*\.[jt]sx?$/.test(file))
    .map(file => path.resolve(root, file));
  const sources = await Promise.all(projectInputs.map(async file => ({
    content: await readFile(file, 'utf8'), extension: path.extname(file).slice(1),
  })));
  const compiler = await compile(await readFile(path.join(root, 'src/app/globals.css'), 'utf8'), {
    base: root,
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? requireFromProject.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.join(root, 'node_modules/tw-animate-css/dist/tw-animate.css')
          : requireFromProject.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: entry, extension: 'tsx' }, ...sources]));
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
}, 45000);

afterAll(async () => { await browser?.close(); });

async function fixture(theme: Theme, streaming = false): Promise<{ page: Page; context: BrowserContext; faults: string[] }> {
  const context = await browser.newContext({ viewport: streaming ? { width: 640, height: 320 } : { width: 320, height: 640 }, isMobile: true,
    hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
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
    } else if (streaming && safe && url.pathname === '/api/chat-tasks'
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
  if (streaming) await page.addInitScript(() => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      id: `history-${i}`, role: 'user', content: `合成历史 ${i} ${'历史内容 '.repeat(30)}`, timestamp: 100 + i,
    }));
    localStorage.setItem('chat-sessions', JSON.stringify([{ id: 'synth', title: '合成历史', model: 'demo::chat',
      systemPrompt: '', createdAt: 1, updatedAt: 2, messages }]));
    const nativeFetch = window.fetch.bind(window);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const bridge = {
      calls: 0,
      emit(content: string): void {
        if (!controller) throw new Error('synthetic stream not open');
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'delta', content })}\n\n`));
      },
      close(): void { if (controller) { controller.close(); controller = undefined; } },
    };
    Object.assign(window, { compactStreamFixture: bridge });
    window.fetch = (request, init) => {
      const url = new URL(request instanceof Request ? request.url : String(request), location.href);
      const method = init?.method || (request instanceof Request ? request.method : 'GET');
      if (url.origin === location.origin && url.pathname === '/api/chat' && !url.search && method === 'POST') {
        bridge.calls++;
        if (bridge.calls !== 1) throw new Error('unexpected duplicate chat request');
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }),
          { headers: { 'content-type': 'text/event-stream' } }));
      }
      return nativeFetch(request, init);
    };
  });
  await page.goto(`${origin}/`);
  await page.evaluate(value => {
    Object.assign(window, { __rotationTheme: value });
    document.documentElement.classList.toggle('dark', value === 'gold');
    document.documentElement.classList.toggle('theme-monochrome', value === 'monochrome');
  }, theme);
  await page.addScriptTag({ content: bundle });
  return { page, context, faults };
}

describe('canvas chat compact rotation focus', () => {
  it.each<readonly [Theme, Menu]>([
    ['gold', 'model'], ['gold', 'agent'], ['monochrome', 'model'], ['monochrome', 'agent'],
  ])('%s %s keeps focus and draft through portrait and landscape', async (theme, menu) => {
    const { page, context, faults } = await fixture(theme);
    try {
      const input = page.locator('textarea').last();
      await input.waitFor();
      await input.fill(draft);
      await page.locator('input[type=file][accept="image/*"]').setInputFiles([0, 1].map(i => ({
        name: `旋转${i}.png`, mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from([i])]),
      })));
      const references = page.getByText('2张图片引用', { exact: true });
      await references.waitFor();
      const referenceImages = references.locator('xpath=../..').locator('div.group img');
      expect(await referenceImages.count()).toBe(2);
      const imageSources = await referenceImages.evaluateAll(images => images.map(image => image.getAttribute('src')));
      expect(imageSources[0]).not.toBe(imageSources[1]);
      const first = page.getByRole('button', { name: '移除第1张参考图 旋转0.png', exact: true });
      const second = page.getByRole('button', { name: '移除第2张参考图 旋转1.png', exact: true });
      expect(await first.count()).toBe(1);
      expect(await second.count()).toBe(1);
      const trigger = menu === 'model' ? page.getByRole('combobox').first()
        : page.getByRole('button', { name: '智能体', exact: true });
      if (menu === 'model') await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes('合成模型'));
      const popup = page.getByRole(menu === 'model' ? 'listbox' : 'menu');

      await trigger.focus();
      await page.keyboard.press('Space');
      await popup.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await popup.waitFor({ state: 'hidden' });
      await expect.poll(() => trigger.evaluate(element => document.activeElement === element)).toBe(true);

      await page.keyboard.press('Space');
      await popup.waitFor({ state: 'visible' });
      await page.waitForFunction(role => Boolean(document.activeElement?.closest(`[role="${role}"]`)), menu === 'model' ? 'listbox' : 'menu');
      await page.setViewportSize({ width: 640, height: 320 });
      const disclosure = page.getByRole('button', { name: '展开聊天设置和导航', exact: true });
      await disclosure.waitFor({ state: 'visible' });
      await popup.waitFor({ state: 'hidden' });
      expect(await trigger.isVisible()).toBe(false);
      await expect.poll(() => disclosure.evaluate(element => document.activeElement === element)).toBe(true);
      expect(await input.inputValue()).toBe(draft);
      expect(await references.count()).toBe(1);
      expect(await first.count()).toBe(1);
      expect(await second.count()).toBe(1);
      expect(await referenceImages.evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(imageSources);

      await page.keyboard.press('Space');
      await page.getByRole('button', { name: '收起聊天设置和导航', exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '智能对话', exact: true }).isVisible()).toBe(true);
      await page.setViewportSize({ width: 320, height: 640 });
      await trigger.waitFor({ state: 'visible' });
      expect(await input.inputValue()).toBe(draft);
      expect(await references.count()).toBe(1);
      expect(await first.count()).toBe(1);
      expect(await second.count()).toBe(1);
      expect(await referenceImages.evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(imageSources);
    } finally {
      try {
        await page.evaluate(() => (window as unknown as { rotationFixtureUnmount: () => void }).rotationFixtureUnmount());
      } finally {
        await context.close();
      }
    }
    expect(faults).toEqual([]);
  }, 30000);
});

describe('canvas chat compact streaming scroll', () => {
  it('keeps a manually scrolled reading position, then follows again after returning to the bottom', async () => {
    const { page, context, faults } = await fixture('gold', true);
    const input = page.locator('textarea').last();
    const list = page.locator('[class*="overscroll-contain"][class*="space-y-3"]').first();
    const measure = () => list.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight,
      total: element.scrollHeight, distance: element.scrollHeight - element.scrollTop - element.clientHeight }));
    const emit = (text: string) => page.evaluate(value => (window as unknown as {
      compactStreamFixture: { emit: (content: string) => void };
    }).compactStreamFixture.emit(value), text);
    const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    try {
      await input.waitFor();
      await input.fill('合成提问');
      await input.press('Enter');
      await page.waitForFunction(() => (window as unknown as { compactStreamFixture?: { calls: number } }).compactStreamFixture?.calls === 1);
      await page.locator('input[type=file][accept="image/*"]').setInputFiles([0, 1].map(i => ({
        name: `流中${i}.png`, mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from([i])]),
      })));
      const references = page.getByText('2张图片引用', { exact: true });
      await references.waitFor();
      // The editor is disabled while streaming. Exercise the existing workspace
      // externalPrompt prop instead of pretending a user can type into it.
      expect(await input.isDisabled()).toBe(true);
      await page.evaluate(() => (window as unknown as { rotationInjectPrompt: (value: string) => void })
        .rotationInjectPrompt('流式中保留草稿'));
      await expect.poll(() => input.inputValue()).toBe('流式中保留草稿');
      const images = references.locator('xpath=../..').locator('div.group img');
      expect(await images.count()).toBe(2);
      const imageSources = await images.evaluateAll(elements => elements.map(element => element.getAttribute('src')));
      expect(imageSources[0]).not.toBe(imageSources[1]);

      await emit('起始回复 '.repeat(20));
      await page.getByText(/起始回复/).first().waitFor();
      await expect.poll(async () => (await measure()).distance).toBeLessThanOrEqual(2);
      const box = await list.boundingBox();
      if (!box) throw new Error('message list is not visible');
      expect(box.height).toBeGreaterThanOrEqual(96);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -45);
      await expect.poll(async () => (await measure()).distance).toBeGreaterThan(5);
      const reading = await measure();
      expect(reading.distance).toBeLessThan(100);
      await emit(' 新的流式内容 '.repeat(20));
      await page.getByText(/新的流式内容/).first().waitFor();
      await settle();
      const after = await measure();
      expect(after.total).toBeGreaterThan(reading.total);
      expect(Math.abs(after.top - reading.top)).toBeLessThanOrEqual(3);

      await page.mouse.wheel(0, 10000);
      await expect.poll(async () => (await measure()).distance).toBeLessThanOrEqual(2);
      await emit(' 结束前的新内容 '.repeat(20));
      await page.getByText(/结束前的新内容/).first().waitFor();
      await expect.poll(async () => (await measure()).distance).toBeLessThanOrEqual(2);
      expect(await input.inputValue()).toBe('流式中保留草稿');
      expect(await references.count()).toBe(1);
      expect(await page.getByRole('button', { name: '移除第1张参考图 流中0.png', exact: true }).count()).toBe(1);
      expect(await page.getByRole('button', { name: '移除第2张参考图 流中1.png', exact: true }).count()).toBe(1);
      expect(await images.evaluateAll(elements => elements.map(element => element.getAttribute('src')))).toEqual(imageSources);
    } finally {
      try {
        await page.evaluate(() => {
          const fixture = window as unknown as { compactStreamFixture?: { close: () => void }; rotationFixtureUnmount: () => void };
          fixture.compactStreamFixture?.close(); fixture.rotationFixtureUnmount();
        });
      } finally { await context.close(); }
    }
    expect(faults).toEqual([]);
  }, 30000);
});
