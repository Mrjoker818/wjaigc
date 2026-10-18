// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAPABILITY_CATALOG_VERSION, type TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

// Static checking extracts this exact stdin. No editor/hook/geometry aliases.
const BROWSER_ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import VideoPanel from '@/components/video-generation-panel';
import DisplayPanel from '@/components/display3d-panel';
const root = createRoot(document.getElementById('fixture-root')!);
let releaseHold: (() => void) | undefined;
let hold: Promise<void> | undefined;
const state = { submissions: [] as unknown[], closes: 0, errors: [] as string[], active: 0 };
const recordVideoGenerate: React.ComponentProps<typeof VideoPanel>['onVideoGenerate'] = async params => {
  state.submissions.push(params); state.active++;
  try { await hold; return { taskId: 'offline-video-generation' }; } finally { state.active--; }
};
// Only keyboard viewport events are simulated. DOMRect/layout remain native.
const visual = Object.assign(new EventTarget(), {
  width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0,
});
Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
const settle = async (): Promise<void> => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};
Object.assign(window, { videoDisplayFixture: {
  state, settle,
  mount(kind: 'video' | 'display', prompt: string, reference: string, pending: boolean): void {
    if (pending) hold = new Promise<void>(resolve => { releaseHold = resolve; });
    root.render(kind === 'video'
      ? <VideoPanel floating selectedImageUrl={reference} externalPrompt={prompt}
          onVideoGenerate={recordVideoGenerate}
          onError={message => { state.errors.push(message); }} onClose={() => { state.closes++; }} />
      : <DisplayPanel sourceImage={{ id: 'reference', url: reference, prompt }} onClose={() => { state.closes++; }} />);
  },
  async viewport(width: number, height: number, left = 0, top = 0): Promise<void> {
    Object.assign(visual, { width, height, offsetLeft: left, offsetTop: top });
    window.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll'));
    await settle();
  },
  async release(): Promise<void> {
    releaseHold?.(); await hold;
    // Drain the original video's progress interval/1200ms completion reset.
    await new Promise<void>(resolve => setTimeout(resolve, 1250)); await settle();
  },
  unmount(): void { root.unmount(); },
} });
`;

type Kind = 'video' | 'display';
interface FixtureState { submissions: Array<{ model: string; providerId: string; prompt: string }>; closes: number; errors: string[]; active: number }
interface BrowserFixture {
  state: FixtureState;
  mount: (kind: Kind, prompt: string, reference: string, pending: boolean) => void;
  viewport: (width: number, height: number, left?: number, top?: number) => Promise<void>;
  settle: () => Promise<void>;
  release: () => Promise<void>;
  unmount: () => void;
}
declare global { interface Window { videoDisplayFixture: BrowserFixture } }
const descriptor: TaskModelDescriptor = {
  providerId: 'offline', modelId: 'offline-video', kind: 'video', sourceType: 'video',
  protocol: 'openai', executionMode: 'async', allowedRatios: ['16:9', '1:1'],
  allowedSizes: ['720p'], qualityOptions: ['std', 'pro'], maxOutputs: 4,
  supportsReferenceImages: true, maxReferenceImages: 4, supportsMask: false,
  allowedDurationsSeconds: [5, 10], maxDurationSeconds: 10,
  supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame', 'multi-reference', 'video-extend'],
  outputKinds: ['video'], capabilitySources: {},
};
const longName = '离线模型与很长的展陈品牌标题用于验证手机工作区保持可读';
const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let browser: Browser; let context: BrowserContext; let page: Page; let css: string; let bundle: string;
let releaseHttp: (() => void) | undefined; let pendingHttp: Promise<void> | undefined;
let httpHoldReleased = false;
const requests: string[] = []; const unknown: string[] = []; const runtimeErrors: string[] = [];
const routeHandlers = new Set<Promise<void>>();
const origin = 'https://video-display.invalid';
const venueTaskId = 'offline-venue-analysis';
const secondaryDescriptor: TaskModelDescriptor = { ...descriptor, providerId: 'offline-alt', modelId: 'offline-video-alt' };

function jsonBody(value: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value || 'null');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function isDisplayGenerationBody(body: Record<string, unknown> | null): boolean {
  if (!body || typeof body.prompt !== 'string' || !body.prompt.includes(longName)) return false;
  const pair = body.providerId === 'offline' && body.model === 'offline-image' ? 'default'
    : body.providerId === 'offline-alt' && body.model === 'offline-image-alt' ? 'secondary' : null;
  if (!pair || !['轻奢质感', '科技未来'].includes(String(body.materialStyle))) return false;
  return isDeepStrictEqual(body, {
    brandName: longName, productName: '', assets: [], imageUsageMode: 'texture_mapping',
    sceneType: 'pop_up_store', environment: 'mall_atrium',
    dimensions: { length: 9000, width: 6000, height: 4500 }, budget: '',
    materialStyle: body.materialStyle, lightingStyle: '明亮聚焦', crowdStyle: '无人',
    viewOptions: ['angle_45', 'front'], renderStyle: '3d_render',
    outputResolution: '3840×2160', outputFormat: 'PNG', outputQuality: '高',
    prompt: body.prompt, model: pair === 'default' ? 'offline-image' : 'offline-image-alt',
    providerId: pair === 'default' ? 'offline' : 'offline-alt', quality: '2K', aspectRatio: '16:9',
  });
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const sources = await Promise.all(['video-generation-panel', 'display3d-panel', 'venue-region-canvas'].map(file => readFile(path.resolve(`src/components/${file}.tsx`), 'utf8')));
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles(sources.map(content => ({ content, extension: 'tsx' }))));
  const result = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: BROWSER_ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'video-display-browser-entry.tsx' },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
beforeEach(async () => {
  requests.length = 0; unknown.length = 0; runtimeErrors.length = 0;
  routeHandlers.clear(); releaseHttp = undefined; pendingHttp = undefined; httpHoldReleased = false;
  context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    const method = request.method(); const rawBody = request.postData(); const body = jsonBody(rawBody);
    const key = `${method} ${url.pathname}${url.search}`;
    requests.push(key);
    const handle = async (): Promise<void> => {
      const kind = url.searchParams.get('type');
      if (request.url() === `${origin}/` && method === 'GET' && rawBody === null && request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return;
      }
      if (request.url() === `${origin}/api/models?type=${kind}` && method === 'GET' && rawBody === null
        && ['video', 'image', 'chat'].includes(kind || '')) {
        await route.fulfill({ json: { success: true, capabilityCatalogVersion: CAPABILITY_CATALOG_VERSION,
          providers: [{ id: 'offline', name: longName, isEnabled: true }, { id: 'offline-alt', name: `${longName}备用`, isEnabled: true }],
          models: [
            { id: `offline-${kind}`, name: longName, providerId: 'offline', type: kind, isDefault: true },
            { id: `offline-${kind}-alt`, name: `${longName}备用`, providerId: 'offline-alt', type: kind, isDefault: false },
          ],
          taskModelCatalog: kind === 'video' ? [descriptor, secondaryDescriptor] : [],
        } }); return;
      }
      if (request.url() === `${origin}/api/display-3d/generate` && method === 'POST' && isDisplayGenerationBody(body)) {
        await pendingHttp; await route.fulfill({ json: { results: [] } }); return;
      }
      if (request.url() === `${origin}/api/activity-venue/analyze` && method === 'POST'
        && [
          { venueImageUrl: reference, brief: '品牌快闪', model: 'offline-chat', providerId: 'offline' },
          { venueImageUrl: reference, brief: '品牌快闪', model: 'offline-chat-alt', providerId: 'offline-alt' },
        ].some(allowed => isDeepStrictEqual(body, allowed))) {
        await route.fulfill({ json: { taskId: venueTaskId } }); return;
      }
      if (request.url() === `${origin}/api/poll-task` && method === 'POST' && isDeepStrictEqual(body, { taskId: venueTaskId })) {
        await route.fulfill({ json: { status: 'completed', result: { analysis: {
          spaceType: '展厅', estimatedDimensions: { length: 9000, width: 6000, height: 4500 },
          lighting: '自然光', regions: [], structuralLimits: [], designNotes: '离线夹具',
        } } } }); return;
      }
      unknown.push(`${method} ${request.url()} body=${rawBody}`); await route.abort();
    };
    const running = handle(); routeHandlers.add(running);
    try { await running; } finally { routeHandlers.delete(running); }
  });
  page = await context.newPage(); page.setDefaultTimeout(1500);
  page.on('pageerror', error => { runtimeErrors.push(error.message); });
  // The only bootstrap response is fulfilled locally; no real HTTP server.
  await page.goto(`${origin}/`);
  await page.addScriptTag({ content: bundle });
}, 10000);
afterEach(async () => {
  try {
    releaseHttp?.(); await pendingHttp; await Promise.all([...routeHandlers]);
  } finally {
    releaseHttp?.();
    try {
      if (page && !page.isClosed()) await page.evaluate(async () => {
        try { await window.videoDisplayFixture?.release(); }
        finally { window.videoDisplayFixture?.unmount(); }
      });
    } finally { await context?.close(); }
  }
  if (unknown.length > 0) throw new Error(`FIXTURE_UNEXPECTED_HTTP: ${unknown.join('\n')}`);
  if (runtimeErrors.length > 0) throw new Error(`FIXTURE_BROWSER_RUNTIME_ERROR: ${runtimeErrors.join('\n')}`);
}, 10000);
afterAll(async () => { await browser?.close(); });

async function settle(): Promise<void> { await page.evaluate(() => window.videoDisplayFixture.settle()); }
async function viewport(width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.evaluate(({ width, height }) => window.videoDisplayFixture.viewport(width, height), { width, height });
}
async function mount(kind: Kind, width: number, height: number, hold = false): Promise<void> {
  await viewport(width, height);
  if (hold) pendingHttp = new Promise<void>(resolve => { releaseHttp = () => { httpHoldReleased = true; resolve(); }; });
  await page.evaluate(({ kind, longName, reference, hold }) => { window.videoDisplayFixture.mount(kind, longName, reference, hold); }, { kind, longName, reference, hold });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('select option')).some(option => option.getAttribute('value')?.includes('offline')));
  if (kind === 'display') {
    await page.waitForFunction(() => {
      const values = Array.from(document.querySelectorAll('select')).map(select => select.value);
      return values.includes('offline::offline-image') && values.includes('offline::offline-chat');
    });
    await page.getByPlaceholder('如：NIKE、星巴克、华为').fill(longName);
  }
  else await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '生成视频');
    return Boolean(button && !button.disabled);
  });
  await settle();
}
function panel(kind: Kind): Locator {
  return kind === 'video'
    ? page.getByRole('heading', { name: '视频生成器', exact: true }).locator('xpath=../../..')
    : page.getByRole('button', { name: '关闭 3D 展陈系统', exact: true }).locator('xpath=../../..');
}
function preview(): Locator {
  return page.locator('section').filter({ has: page.getByRole('button', { name: '多角度', exact: true }) })
    .filter({ has: page.getByRole('button', { name: '物料清单BOM', exact: true }) });
}
function input(kind: Kind): Locator { return kind === 'video' ? panel(kind).locator('textarea').first() : page.getByPlaceholder('如：NIKE、星巴克、华为'); }
function closeName(kind: Kind): string { return kind === 'video' ? '关闭' : '关闭 3D 展陈系统'; }
function minimizeName(kind: Kind): string { return kind === 'video' ? '最小化' : '最小化 3D 展陈系统'; }
function restoreName(kind: Kind): string { return kind === 'video' ? '展开面板' : '展开 3D 展陈系统'; }
async function fits(kind: Kind, width: number, height: number, left = 0, top = 0): Promise<void> {
  await settle(); const rect = await panel(kind).boundingBox(); expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(left + 8); expect(rect!.y).toBeGreaterThanOrEqual(top + 8);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(left + width - 8);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(top + height - 8);
  if (width < 1024) expect(rect!.width).toBeGreaterThanOrEqual(width - 32);
  for (const name of [closeName(kind), minimizeName(kind)]) {
    const control = page.getByRole('button', { name, exact: true }); await control.click({ trial: true });
    if (width < 1024) { const box = await control.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44); }
  }
  const metrics = await panel(kind).evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
}
async function expectDragBounds(kind: Kind): Promise<void> {
  // Check native geometry BEFORE any subsequent header click. An old offscreen
  // drag must fail as an AssertionError, not a Playwright actionability timeout.
  const rect = await panel(kind).boundingBox(); expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(8); expect(rect!.y).toBeGreaterThanOrEqual(8);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(1432);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(892);
}
async function formAndAction(kind: Kind): Promise<void> {
  await input(kind).scrollIntoViewIfNeeded(); const rect = await input(kind).boundingBox();
  expect(rect!.width).toBeGreaterThanOrEqual(200); expect(rect!.height).toBeGreaterThan(0);
  const action = page.getByRole('button', { name: kind === 'video' ? '生成视频' : '生成展陈方案', exact: true });
  await action.scrollIntoViewIfNeeded(); await action.click({ trial: true });
  if (kind === 'display') {
    expect(await preview().count()).toBe(1);
    const renderTab = preview().getByRole('button', { name: '效果图', exact: true });
    await renderTab.scrollIntoViewIfNeeded(); await renderTab.click(); await settle();
    // The inner stage can collapse while its section remains wide (thumbnails).
    const stage = preview().getByText('设置参数后点击"生成展陈方案"', { exact: true }).locator('xpath=..');
    await expectArea(stage);
  }
}
async function expectArea(target: Locator): Promise<void> {
  expect(await target.count()).toBe(1); await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox(); expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(200); expect(box!.height).toBeGreaterThan(0);
}
async function singleLineText(target: Locator): Promise<void> {
  const measurements = await target.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rows: Array<{ count: number; height: number; limit: number }> = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || !node.parentElement || node.parentElement.closest('svg')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      const style = getComputedStyle(node.parentElement);
      rows.push({ count: rects.length, height: range.getBoundingClientRect().height,
        limit: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 });
    }
    return rows;
  });
  expect(measurements.length).toBeGreaterThan(0);
  for (const row of measurements) { expect(row.count).toBe(1); expect(row.height).toBeLessThanOrEqual(row.limit + 1); }
}
async function videoAction(label: string | RegExp, disabled: boolean): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true });
  expect(await button.isDisabled()).toBe(disabled);
  await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(200); expect(box!.height).toBeGreaterThan(0);
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
  await singleLineText(button);
  if (!disabled) await button.click({ trial: true });
}
async function parameterOptions(label: string, names: string[]): Promise<void> {
  // In the real source each label is a direct child of its parameter group's
  // div; only that parent contains its option buttons. No positional guessing.
  const title = panel('video').locator('label').filter({ hasText: new RegExp(`^${label}$`) });
  expect(await title.count()).toBe(1); await singleLineText(title);
  const group = title.locator('xpath=..');
  const buttons = group.getByRole('button');
  expect(await buttons.allTextContents()).toEqual(names);
  for (const name of names) {
    const button = group.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
    expect(box).not.toBeNull(); expect(box!.width).toBeGreaterThan(0); expect(box!.height).toBeGreaterThan(0);
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.y).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
    await singleLineText(button);
    expect(await button.isDisabled()).toBe(false);
    await button.click({ trial: true });
  }
}
async function videoModes(): Promise<void> {
  for (const label of ['文生视频', '图生视频', '视频延长', '多镜头叙事']) {
    const modeButton = page.getByRole('button', { name: label, exact: true });
    await modeButton.click(); await settle(); await singleLineText(modeButton);
    await expectArea(page.getByRole('slider', { name: '视频时长' }));
    await parameterOptions('画面比例', ['16:9', '1:1']);
    await parameterOptions('生成质量', ['标准', '高清Pro']);
    await parameterOptions('生成数量', ['1x', '2x', '4x']);
    if (label === '文生视频') {
      await expectArea(input('video')); await videoAction('生成视频', false);
    } else if (label === '图生视频') {
      expect(await page.getByRole('img', { name: '首帧', exact: true }).getAttribute('src')).toBe(reference);
      const tail = page.getByRole('button', { name: '添加尾帧（视频结束画面）', exact: true });
      await tail.click(); await singleLineText(tail);
      const uploadTail = page.getByRole('button', { name: '上传尾帧图片', exact: true });
      await expectArea(uploadTail); await singleLineText(uploadTail);
      await tail.click(); expect(await uploadTail.count()).toBe(0);
      const references = page.getByText('风格/场景参考图', { exact: true }).locator('xpath=../..');
      await singleLineText(references.getByText('风格/场景参考图', { exact: true }));
      const add = references.getByRole('button', { name: '+ 添加', exact: true });
      await singleLineText(add);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
      await chooser.setFiles([]); // Cancel original picker; no save-image HTTP is authorized.
      await videoAction('生成视频', false);
    } else if (label === '视频延长') {
      await expectArea(page.getByPlaceholder('输入视频URL（画布选中视频会自动填充）'));
      await parameterOptions('延长时长', ['5秒', '10秒']);
      await videoAction('延长视频', true);
    } else {
      const scene = page.getByPlaceholder('描述开场画面...'); await expectArea(scene);
      await videoAction(/^生成 \d+ 个镜头视频$/, true);
      await scene.fill('离线开场镜头'); await videoAction(/^生成 \d+ 个镜头视频$/, false);
    }
  }
  await page.getByRole('button', { name: '文生视频', exact: true }).click(); await settle();
}
function selectContaining(value: string): Locator {
  return page.locator('select').filter({ has: page.locator(`option[value="${value}"]`) });
}
async function chooseSecondary(kind: Kind): Promise<void> {
  if (kind === 'video') {
    await selectContaining('offline-alt::offline-video-alt').selectOption('offline-alt::offline-video-alt');
    const duration = page.getByRole('slider', { name: '视频时长' });
    await duration.focus(); await duration.press('End'); expect(await duration.inputValue()).toBe('1');
  } else {
    await selectContaining('offline-alt::offline-image-alt').selectOption('offline-alt::offline-image-alt');
    await selectContaining('offline-alt::offline-chat-alt').selectOption('offline-alt::offline-chat-alt');
    await selectContaining('科技未来').selectOption('科技未来');
  }
  await settle();
  const values = await selectedModels();
  expect(values).toContain(kind === 'video' ? 'offline-alt::offline-video-alt' : 'offline-alt::offline-image-alt');
  if (kind === 'display') { expect(values).toContain('offline-alt::offline-chat-alt'); expect(values).toContain('科技未来'); }
}
async function expectRetainedMode(kind: Kind): Promise<void> {
  if (kind === 'video') {
    expect(await page.getByRole('img', { name: '首帧', exact: true }).getAttribute('src')).toBe(reference);
    expect(await page.getByRole('slider', { name: '视频时长' }).inputValue()).toBe('1');
    expect(await page.getByRole('button', { name: '添加尾帧（视频结束画面）', exact: true }).count()).toBe(1);
  } else expect(await page.getByRole('heading', { name: '3D 展陈工作台', exact: true }).count()).toBe(1);
}
async function selectedModels(): Promise<string[]> {
  return page.locator('select').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value));
}
async function state(): Promise<FixtureState> { return page.evaluate(() => window.videoDisplayFixture.state); }

describe('mobile video-display layout', () => {
  for (const kind of ['video', 'display'] as const) {
    it.each([[320, 640], [390, 780], [412, 900], [768, 600], [844, 390], [1440, 900]])(`${kind} keeps workspace and actions reachable at %ix%i`, async (width, height) => {
      await mount(kind, width, height); await fits(kind, width, height); await formAndAction(kind);
      if (kind === 'video') await videoModes();
      if (width === 1440) {
        if (kind === 'display') expect(await page.locator('aside').evaluate(el => el.getBoundingClientRect().width)).toBe(240);
        else expect(await page.getByText('导演风格', { exact: true }).locator('xpath=../../..').evaluate(el => el.getBoundingClientRect().width)).toBe(340);
      }
    }, 10000);
    it(`${kind} retains the session after edge drag minimize resize keyboard and restore`, async () => {
      await mount(kind, 1440, 900);
      await chooseSecondary(kind);
      if (kind === 'video') { await page.getByRole('button', { name: '图生视频', exact: true }).click(); await settle(); }
      else {
        const choosing = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: '主视觉KV', exact: true }).click();
        await (await choosing).setFiles({ name: 'offline-reference.png', mimeType: 'image/png', buffer: Buffer.from(reference.split(',')[1], 'base64') });
        await settle();
      }
      const models = await selectedModels();
      const images = await panel(kind).locator('img').evaluateAll(elements => elements.map(element => element.getAttribute('src')));
      expect(images.length).toBeGreaterThan(0);
      if (kind === 'video') expect(images).toContain(reference);
      const header = kind === 'video' ? page.getByRole('heading', { name: '视频生成器' }).locator('xpath=../..') : panel(kind).locator('[data-panel-header]');
      const box = await header.boundingBox();
      await page.mouse.move(box!.x + 20, box!.y + box!.height / 2); await page.mouse.down();
      await page.mouse.move(1430, 890); await page.mouse.up(); await settle();
      await expectDragBounds(kind);
      await page.getByRole('button', { name: minimizeName(kind), exact: true }).click();
      await viewport(390, 780);
      await page.evaluate(() => window.videoDisplayFixture.viewport(390, 320, 0, 70));
      await page.getByRole('button', { name: restoreName(kind), exact: true }).click();
      await fits(kind, 390, 320, 0, 70);
      expect(await input(kind).inputValue()).toBe(longName); expect(await selectedModels()).toEqual(models);
      await expectRetainedMode(kind);
      expect(await panel(kind).locator('img').evaluateAll(elements => elements.map(element => element.getAttribute('src')))).toEqual(images);
      await page.evaluate(() => window.videoDisplayFixture.viewport(390, 780));
      await fits(kind, 390, 780); await formAndAction(kind);
      await expectRetainedMode(kind); expect(await selectedModels()).toEqual(models);
    }, 10000);
    it(`${kind} keeps one in-flight generation through shrink restore and close without cancellation`, async () => {
      await mount(kind, 1440, 900, true); await chooseSecondary(kind); const models = await selectedModels();
      // Register the request waiter before the real click (no race/retry).
      const generate = page.getByRole('button', { name: kind === 'video' ? '生成视频' : '生成展陈方案', exact: true });
      if (kind === 'display') await Promise.all([
        page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/display-3d/generate'),
        generate.click(),
      ]);
      else await generate.click();
      if (kind === 'video') await page.getByRole('button', { name: restoreName(kind), exact: true }).click();
      await viewport(390, 780); await fits(kind, 390, 780);
      expect(await page.getByText(/生成中/).count()).toBeGreaterThan(0);
      expect(await page.getByRole('button', { name: '生成中...', exact: true }).isDisabled()).toBe(true);
      await page.getByRole('button', { name: minimizeName(kind), exact: true }).click();
      await page.getByRole('button', { name: restoreName(kind), exact: true }).click(); await settle();
      expect(await input(kind).inputValue()).toBe(longName); expect(await selectedModels()).toEqual(models);
      // Recheck component state after restore, before close, with holds intact.
      expect(await page.getByText(/生成中/).count()).toBeGreaterThan(0);
      expect(await page.getByRole('button', { name: '生成中...', exact: true }).isDisabled()).toBe(true);
      expect(kind === 'video' ? (await state()).submissions.length : requests.filter(key => key === 'POST /api/display-3d/generate').length).toBe(1);
      expect(httpHoldReleased).toBe(false);
      if (kind === 'video') expect((await state()).active).toBe(1);
      await page.getByRole('button', { name: closeName(kind), exact: true }).click();
      const snapshot = await state(); expect(snapshot.closes).toBe(1); expect(snapshot.errors).toEqual([]);
      expect(kind === 'video' ? snapshot.submissions.length : requests.filter(key => key === 'POST /api/display-3d/generate').length).toBe(1);
      if (kind === 'video') { expect(snapshot.active).toBe(1); expect(snapshot.submissions[0]).toMatchObject({ providerId: 'offline-alt', model: 'offline-video-alt', prompt: longName, duration: 10 }); }
      expect(requests.some(url => /cancel/.test(url))).toBe(false);
      // afterEach releases callback/HTTP holds, drains completion, unmounts and
      // closes the isolated context even after assertion/actionability failure.
    }, 10000);
  }
  it.each([[390, 780], [844, 390]])('activity mode preserves fields and allows vertical access at %ix%i', async (width, height) => {
    await mount('display', 1440, 900); await chooseSecondary('display'); const models = await selectedModels();
    await page.getByRole('button', { name: '活动现场', exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /点击上传场馆照片/ }).click();
    await (await choosing).setFiles({ name: 'offline-venue.png', mimeType: 'image/png', buffer: Buffer.from(reference.split(',')[1], 'base64') });
    await page.getByRole('button', { name: 'AI 分析场馆', exact: true }).click();
    await page.getByPlaceholder('如：夏季新品发布会').waitFor({ state: 'visible' });
    expect(requests.filter(key => key === 'POST /api/activity-venue/analyze')).toHaveLength(1);
    expect(requests.filter(key => key === 'POST /api/poll-task')).toHaveLength(1);
    await page.getByRole('button', { name: '方案', exact: true }).click();
    await page.getByPlaceholder('如：夏季新品发布会').fill(longName);
    expect(await page.getByPlaceholder('品牌名称').inputValue()).toBe(longName);
    await viewport(width, height); await fits('display', width, height);
    await expectArea(page.getByText('请先填写活动需求并生成方案', { exact: true }).locator('xpath=..'));
    const brand = page.getByPlaceholder('品牌名称'); await brand.scrollIntoViewIfNeeded();
    expect((await brand.boundingBox())!.width).toBeGreaterThanOrEqual(200);
    const generate = page.getByRole('button', { name: '生成 3 套布局方案', exact: true });
    await generate.scrollIntoViewIfNeeded(); await generate.click({ trial: true });
    await page.getByRole('button', { name: '展陈设计', exact: true }).click();
    expect(await input('display').inputValue()).toBe(longName); expect(await selectedModels()).toEqual(models);
    await page.getByRole('button', { name: '活动现场', exact: true }).click();
    await page.getByRole('button', { name: '方案', exact: true }).click();
    expect(await page.getByPlaceholder('如：夏季新品发布会').inputValue()).toBe(longName);
  }, 10000);
});

describe('mobile video-display review', () => {
  it('keeps processing feedback visible while video is automatically minimized on a phone', async () => {
    await mount('video', 390, 780, true);
    await chooseSecondary('video');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    const restore = page.getByRole('button', { name: '展开面板', exact: true });
    await restore.waitFor({ state: 'visible' });
    await settle();
    const badge = panel('video').getByText(/^生成中(?: \d+%)?$/);
    expect(await badge.count()).toBe(1);
    expect(await badge.isVisible()).toBe(true);
    const box = await badge.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(382);
    expect(box!.y).toBeGreaterThanOrEqual(8);
    expect(box!.y + box!.height).toBeLessThanOrEqual(772);
    await singleLineText(badge);
    await restore.click({ trial: true });
    expect((await restore.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await restore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const snapshot = await state();
    expect(snapshot.active).toBe(1);
    expect(snapshot.submissions).toHaveLength(1);
    expect(requests.some(request => /cancel/.test(request))).toBe(false);
  }, 10000);

  it.each(['video', 'display'] as const)('reflows %s by the visible width without resizing the layout viewport', async kind => {
    await mount(kind, 1280, 900);
    await chooseSecondary(kind);
    const models = await selectedModels();
    for (const width of [640, 390]) {
      await page.evaluate(width => window.videoDisplayFixture.viewport(width, 520, 300, 70), width);
      expect(await page.evaluate(() => innerWidth)).toBe(1280);
      await fits(kind, width, 520, 300, 70);
      await formAndAction(kind);
      if (kind === 'video') await expectArea(page.getByRole('slider', { name: '视频时长' }));
      expect(await input(kind).inputValue()).toBe(longName);
      expect(await selectedModels()).toEqual(models);
    }
  }, 10000);

  it('centers display help inside the visible viewport offsets', async () => {
    await mount('display', 1440, 900);
    await page.getByRole('button', { name: '说明', exact: true }).click();
    const heading = page.getByRole('heading', { name: '3D 展陈系统 Pro — 使用说明', exact: true });
    await heading.waitFor({ state: 'visible' });
    await page.evaluate(() => window.videoDisplayFixture.viewport(390, 320, 200, 70));
    await settle();
    const help = heading.locator('xpath=../..');
    const box = await help.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(208);
    expect(box!.y).toBeGreaterThanOrEqual(78);
    expect(box!.x + box!.width).toBeLessThanOrEqual(582);
    expect(box!.y + box!.height).toBeLessThanOrEqual(382);
    const close = heading.locator('xpath=..').getByRole('button');
    expect(await close.count()).toBe(1);
    await close.click();
    expect(await heading.count()).toBe(0);
  }, 10000);
});
