// @vitest-environment node
// Task4 fixture only. Execution requires the controller's image-editor-red admission.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Kept as one literal so the controller can bundle this exact entry without
// importing/executing this host file. All component/library imports are real.
const BROWSER_ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ImageEditor } from '@/components/image-editor';
import { taskEventsClient } from '@/lib/task-events-client';
type Props = React.ComponentProps<typeof ImageEditor>;
const root = createRoot(document.getElementById('fixture-root')!);
const state = { closes: 0, confirms: [] as Parameters<Props['onConfirm']>[0][],
  params: [] as Array<{ aspectRatio: string; quality: string; count: number }> };
function asset(color: string): { png: string; jpeg: string } {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('FIXTURE_CANVAS_CONTEXT_MISSING');
  ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(16, 16, 16, 24);
  return { png: canvas.toDataURL('image/png'), jpeg: canvas.toDataURL('image/jpeg', 0.85) };
}
const original = asset('#3478a4'); const reference = asset('#b77531');
const result1 = asset('#438a4c'); const result2 = asset('#8743a1');
const media = { original: original.png, originalJpeg: original.jpeg,
  reference: reference.png, referenceJpeg: reference.jpeg, results: [result1.png, result2.png] };
const main = { id: 'offline-main', url: media.original, prompt: '离线原图',
  x: 0, y: 0, width: 64, height: 64, originalWidth: 64, originalHeight: 64 };
const ref = { ...main, id: 'offline-reference', url: media.reference, prompt: '离线参考图' };
// Only visualViewport keyboard metrics/events are synthesized; layout, Range,
// DOMRect, canvas, mouse events, fetch and EventSource remain native.
const visual = Object.assign(new EventTarget(), {
  width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0,
});
Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
const settle = async (): Promise<void> => {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};
let mounted = false; let unmounted = false;
const onParamsChange: NonNullable<Props['onParamsChange']> = params => { state.params.push(params); };
Object.assign(window, { imageEditorFixture: {
  state, media, settle,
  mount(theme: 'gold' | 'monochrome', hasImage: boolean): void {
    if (mounted) throw new Error('FIXTURE_REMOUNT_FORBIDDEN');
    mounted = true;
    root.render(<ImageEditor image={hasImage ? main : null} canvasImages={[main, ref]}
      themeStyle={theme} onClose={() => { state.closes++; }}
      onConfirm={result => { state.confirms.push(result); }} onParamsChange={onParamsChange} />);
  },
  async viewport(width: number, height: number, left = 0, top = 0): Promise<void> {
    Object.assign(visual, { width, height, offsetLeft: left, offsetTop: top });
    window.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll'));
    await settle();
  },
  async unmountAndDisconnect(): Promise<void> {
    try { if (!unmounted) { root.unmount(); unmounted = true; } }
    finally { taskEventsClient.disconnect(); }
    await settle();
  },
} });
`;

type Theme = 'gold' | 'monochrome';
interface Params { aspectRatio: string; quality: string; count: number }
interface FixtureState { closes: number; confirms: Array<{ url: string; prompt: string; aspectRatio?: string }>; params: Params[] }
interface Media { original: string; originalJpeg: string; reference: string; referenceJpeg: string; results: string[] }
interface BrowserFixture {
  state: FixtureState; media: Media;
  mount: (theme: Theme, hasImage: boolean) => void;
  settle: () => Promise<void>;
  viewport: (width: number, height: number, left?: number, top?: number) => Promise<void>;
  unmountAndDisconnect: () => Promise<void>;
}
declare global { interface Window { imageEditorFixture: BrowserFixture } }
interface Plan { count: number; mask: string | null; references: string[] | undefined }
interface Session {
  context: BrowserContext; page: Page; media: Media; plan: Plan;
  requests: string[]; submissions: Record<string, unknown>[]; cancels: string[];
  faults: string[]; handlers: Set<Promise<void>>; fetches: Set<Request>;
  release: (terminal: 'failed' | 'completed') => void;
  released: boolean; terminalServed: boolean; mounted: boolean;
}
const ORIGIN = 'https://image-editor-task4.invalid';
const TASK_ID = 'edit_offline_task4';
const TERMINAL_ERROR = '离线夹具任务结束';
const MODEL_ID = 'gpt-image-2';
const LLM_ID = 'offline-chat';
const IMAGE_NAME = '离线图像模型长名称用于检验语言修图手机标题与模型栏截断';
const LLM_NAME = '离线协作模型长名称用于检验供应商选择保持';
const PROVIDERS = [{ id: 'offline-first', name: '离线供应商甲' }, { id: 'offline-second', name: '离线供应商乙' }];
const PROMPT = '把背景换成日落，保留主体与参考图的配色';
const VIEWPORTS = [[320, 640], [375, 812], [430, 900], [768, 600], [844, 390], [1440, 900]];
let browser: Browser | undefined;
let css = ''; let bundle = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile(path.resolve('src/components/image-editor.tsx'), 'utf8');
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: source, extension: 'tsx' }]));
  const result = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: BROWSER_ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'image-editor-browser-entry.tsx' },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

function parseBody(raw: string | null): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(raw || 'null');
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}
function expectedSubmission(s: Session): Record<string, unknown> {
  return {
    image: s.media.originalJpeg, prompt: PROMPT, mask: s.plan.mask, size: '4:3', quality: 'medium',
    model: MODEL_ID, providerId: PROVIDERS[1].id, llmModelId: LLM_ID, llmProviderId: PROVIDERS[1].id,
    ...(s.plan.references ? { referenceImages: s.plan.references } : {}), editHistory: [], count: s.plan.count,
  };
}
async function openSession(): Promise<Session> {
  if (!browser) throw new Error('FIXTURE_BROWSER_NOT_INITIALIZED');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    let releaseHold: (() => void) | undefined;
    let terminal: 'failed' | 'completed' = 'failed';
    const hold = new Promise<void>(resolve => { releaseHold = resolve; });
    const s: Session = {
      context, page, media: { original: '', originalJpeg: '', reference: '', referenceJpeg: '', results: [] },
      plan: { count: 2, mask: null, references: undefined },
      requests: [], submissions: [], cancels: [], faults: [], handlers: new Set(), fetches: new Set(),
      released: false, terminalServed: false, mounted: false,
      release(value): void { if (!s.released) { terminal = value; s.released = true; releaseHold?.(); } },
    };
    page.on('pageerror', error => { s.faults.push(`PAGEERROR: ${error.message}`); });
    page.on('request', request => { if (request.resourceType() === 'fetch') s.fetches.add(request); });
    page.on('requestfinished', request => { s.fetches.delete(request); });
    page.on('requestfailed', request => { s.fetches.delete(request); });
    await context.route('**/*', async route => {
      const request = route.request(); const url = request.url();
      const method = request.method(); const raw = request.postData(); const body = parseBody(raw);
      s.requests.push(`${method} ${url}`);
      const handle = async (): Promise<void> => {
        if (url === `${ORIGIN}/` && method === 'GET' && raw === null && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return;
        }
        if (url === `${ORIGIN}/api/edit` && method === 'GET' && raw === null) {
          await route.fulfill({ json: { supportedModels: [MODEL_ID, MODEL_ID], models: PROVIDERS.map(provider => ({
            id: MODEL_ID, name: IMAGE_NAME, providerId: provider.id, providerName: provider.name, supportsMask: true,
          })) } }); return;
        }
        if (url === `${ORIGIN}/api/models?type=chat` && method === 'GET' && raw === null) {
          await route.fulfill({ json: { success: true, providers: PROVIDERS.map(provider => ({ ...provider, isEnabled: true })),
            models: PROVIDERS.map(provider => ({ id: LLM_ID, name: LLM_NAME, providerId: provider.id, type: 'chat' })),
          } }); return;
        }
        if (url === `${ORIGIN}/api/session` && method === 'GET' && raw === null) {
          await route.fulfill({ json: { success: true, user: { id: 'offline-task4-user', username: 'offline-task4', role: 'user' } } }); return;
        }
        if (url === `${ORIGIN}/api/task-events` && method === 'GET' && raw === null) {
          // Finite local SSE; reconnects use the real client's unchanged backoff.
          await route.fulfill({ contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' },
            body: `data: ${JSON.stringify({ type: 'connected', transport: 'offline', timestamp: 0 })}\n\n:heartbeat\n\n` }); return;
        }
        const json = request.headers()['content-type']?.split(';')[0] === 'application/json';
        if (url === `${ORIGIN}/api/edit` && method === 'POST' && json && isDeepStrictEqual(body, expectedSubmission(s))) {
          s.submissions.push(body!);
          if (s.submissions.length > 1) throw new Error('FIXTURE_DUPLICATE_EDIT_SUBMISSION');
          await route.fulfill({ json: { success: true, taskId: TASK_ID } }); return;
        }
        if (url === `${ORIGIN}/api/poll-task` && method === 'POST' && json && s.submissions.length === 1
          && isDeepStrictEqual(body, { taskId: TASK_ID, model: MODEL_ID, providerId: PROVIDERS[1].id })) {
          await hold;
          await route.fulfill({ json: terminal === 'completed'
            ? { success: true, status: 'completed', stage: '完成', result: { success: true,
              image: { url: s.media.results[0] }, images: s.media.results.slice(0, s.plan.count).map(url => ({ url })),
              llmInstruction: PROMPT, editRegions: [] } }
            : { success: false, status: 'failed', stage: '失败', error: TERMINAL_ERROR, retryable: false } });
          s.terminalServed = true; return;
        }
        if (url === `${ORIGIN}/api/cancel-task` && method === 'POST' && json && s.submissions.length === 1
          && isDeepStrictEqual(body, { taskId: TASK_ID })) {
          s.cancels.push(TASK_ID);
          await route.fulfill({ json: { success: true, message: '任务已取消' } });
          // A supported failed terminal drains the existing loop. This fixture
          // does not claim to validate the API's cancelled-status state machine.
          s.release('failed'); return;
        }
        s.faults.push(`UNEXPECTED_HTTP: ${method} ${url} body=${raw}`);
        await route.abort('blockedbyclient');
      };
      const running = handle(); s.handlers.add(running);
      try { await running; }
      catch (error) {
        s.faults.push(`ROUTE_ERROR: ${error instanceof Error ? error.message : String(error)}`);
        await route.abort('failed').catch(() => undefined);
      } finally { s.handlers.delete(running); }
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    s.media = await page.evaluate(() => window.imageEditorFixture.media);
    return s;
  } catch (error) { await context.close(); throw error; }
}

async function dispose(s: Session): Promise<void> {
  const failures: string[] = [];
  try {
    if (s.submissions.length && !s.terminalServed) s.release('failed');
    else if (!s.released) s.release('failed');
    await Promise.all([...s.handlers]);
    if (s.mounted) {
      // No fake timers or shortened product delays: let the original 500ms
      // initial poll and handleSubmit's finally finish before root.unmount().
      await s.page.waitForFunction(({ submitted, terminalError }) => {
        const loading = Array.from(document.querySelectorAll('button')).some(el => el.textContent?.trim() === '修改中...');
        return !loading && (!submitted || document.body.textContent?.includes(terminalError)
          || document.querySelector('img[alt="结果 1"]') !== null
          || window.imageEditorFixture.state.confirms.length > 0);
      }, { submitted: s.submissions.length > 0, terminalError: TERMINAL_ERROR });
      await settle(s);
    }
  } catch (error) { failures.push(`DRAIN: ${error instanceof Error ? error.message : String(error)}`); }
  finally {
    try {
      if (!s.page.isClosed()) await s.page.evaluate(() => window.imageEditorFixture?.unmountAndDisconnect());
      await Promise.all([...s.handlers]);
      if (s.fetches.size) failures.push(`UNSETTLED_FETCH: ${[...s.fetches].map(request => request.url()).join(', ')}`);
    } catch (error) { failures.push(`UNMOUNT: ${error instanceof Error ? error.message : String(error)}`); }
    finally { await s.context.close(); }
  }
  if (failures.length) throw new Error(`FIXTURE_CLEANUP_ERROR: ${failures.join('\n')}`);
}
async function withSession(run: (session: Session) => Promise<void>): Promise<void> {
  const s = await openSession(); let failed = false; let failure: unknown; let cleanupFailure: unknown;
  try { await run(s); } catch (error) { failed = true; failure = error; }
  try { await dispose(s); } catch (error) { cleanupFailure = error; }
  // Infrastructure always wins over an unrelated product assertion. Never
  // repackage locator/bootstrap/body/page errors as AssertionError/valid RED.
  if (s.faults.length || cleanupFailure) throw new Error(`FIXTURE_INFRASTRUCTURE_ERROR:\n${s.faults.join('\n')}\n${cleanupFailure ? String(cleanupFailure) : ''}`);
  if (failed) throw failure;
}
async function settle(s: Session): Promise<void> { await s.page.evaluate(() => window.imageEditorFixture.settle()); }
async function viewport(s: Session, width: number, height: number): Promise<void> {
  await s.page.setViewportSize({ width, height });
  await s.page.evaluate(([w, h]) => window.imageEditorFixture.viewport(w, h), [width, height]);
}
async function mount(s: Session, theme: Theme, width: number, height: number, hasImage: boolean): Promise<void> {
  await viewport(s, width, height);
  await s.page.evaluate(({ theme, hasImage }) => window.imageEditorFixture.mount(theme, hasImage), { theme, hasImage });
  s.mounted = true;
  // Readiness/selector failures are ordinary Playwright Errors, never UI RED.
  await modelTrigger(s, 'image').waitFor({ state: 'visible' });
  await modelTrigger(s, 'llm').waitFor({ state: 'visible' });
  if (hasImage) await s.page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('img[alt="编辑"]');
    const canvas = document.querySelector('canvas');
    return image?.complete && image.naturalWidth === 64 && canvas?.width === 260;
  });
  await settle(s);
}
function header(s: Session): Locator {
  return s.page.locator('[data-panel-header]').filter({ has: s.page.getByText('语言修图', { exact: true }) });
}
function panel(s: Session): Locator { return header(s).locator('xpath=..'); }
function headerControl(s: Session, kind: 'close' | 'minimize'): Locator {
  // The frozen source has no names for these buttons. Use its real header/SVG
  // structure; assert the missing accessible name explicitly in headerChecks.
  return header(s).locator('button').filter({ has: s.page.locator(kind === 'close' ? 'svg.lucide-x' : 'svg.lucide-minus') });
}
function modelTrigger(s: Session, kind: 'image' | 'llm'): Locator {
  return panel(s).locator('button').filter({ hasText: kind === 'image' ? IMAGE_NAME : LLM_NAME })
    .filter({ has: s.page.locator('svg.lucide-chevron-down, svg.lucide-chevron-up') });
}
function param(s: Session, label: string): Locator {
  // Existing labels have no htmlFor; use the actual label/select parent.
  return panel(s).locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('select');
}
function prompt(s: Session): Locator { return panel(s).getByPlaceholder('描述修改内容，如：把背景换成日落... (输入 / 模板 · @ 引用图片)'); }
function resultRegion(s: Session): Locator { return s.page.getByRole('heading', { name: '修图结果', exact: true }).locator('xpath=../..'); }
async function unique(target: Locator): Promise<void> {
  const count = await target.count();
  if (count !== 1) throw new Error(`FIXTURE_SELECTOR_CARDINALITY: expected one, got ${count}: ${target}`);
}
async function rect(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await unique(target); const box = await target.boundingBox();
  if (!box) throw new Error(`FIXTURE_ELEMENT_NOT_RENDERED: ${target}`);
  return box;
}
async function within(s: Session, target: Locator, minWidth = 0): Promise<void> {
  const box = await rect(target);
  const view = await s.page.evaluate(() => ({ width: visualViewport!.width, height: visualViewport!.height,
    x: visualViewport!.offsetLeft, y: visualViewport!.offsetTop }));
  expect(box.width).toBeGreaterThanOrEqual(minWidth); expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(view.x + 8); expect(box.y).toBeGreaterThanOrEqual(view.y + 8);
  expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width - 8);
  expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height - 8);
}
async function reach(s: Session, target: Locator, disabled: boolean, minWidth = 0): Promise<void> {
  await unique(target);
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(s); await within(s, target, minWidth);
  const clipping = await target.evaluate(element => {
    const box = element.getBoundingClientRect(); let left = box.left; let top = box.top; let right = box.right; let bottom = box.bottom;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent); const clip = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    return { width: box.width, height: box.height, visibleWidth: right - left, visibleHeight: bottom - top };
  });
  expect(clipping.visibleWidth).toBeGreaterThanOrEqual(clipping.width - 1);
  expect(clipping.visibleHeight).toBeGreaterThanOrEqual(clipping.height - 1);
  expect(await target.isDisabled()).toBe(disabled);
  if (!disabled) await target.click({ trial: true });
}
async function singleLine(target: Locator): Promise<void> {
  await unique(target);
  const rows = await target.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rows: Array<{ count: number; height: number; limit: number }> = []; let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || !node.parentElement || node.parentElement.closest('svg')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const style = getComputedStyle(node.parentElement);
      rows.push({ count: [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0).length,
        height: range.getBoundingClientRect().height, limit: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 });
    }
    return rows;
  });
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) { expect(row.count).toBe(1); expect(row.height).toBeLessThanOrEqual(row.limit + 1); }
}
async function noHorizontalOverflow(s: Session, target: Locator): Promise<void> {
  await unique(target);
  const size = await target.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  const documentSize = await s.page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(documentSize.scroll).toBeLessThanOrEqual(documentSize.client + 1);
}
async function bounds(s: Session, width: number, height: number, left = 0, top = 0): Promise<void> {
  await settle(s); const box = await rect(panel(s));
  expect(box.x).toBeGreaterThanOrEqual(left + 8); expect(box.y).toBeGreaterThanOrEqual(top + 8);
  expect(box.x + box.width).toBeLessThanOrEqual(left + width - 8);
  expect(box.y + box.height).toBeLessThanOrEqual(top + height - 8);
  expect(box.width).toBeGreaterThanOrEqual(Math.min(440, width - 32));
  expect(box.width).toBeLessThanOrEqual(441);
  await noHorizontalOverflow(s, panel(s));
}
async function headerChecks(s: Session, minimized = false): Promise<void> {
  const title = header(s).getByText('语言修图', { exact: true }); await singleLine(title);
  expect((await rect(header(s))).height).toBeGreaterThanOrEqual(44);
  for (const kind of ['minimize', 'close'] as const) {
    const button = headerControl(s, kind); const box = await rect(button);
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    const name = kind === 'close' ? /关闭.*语言修图|语言修图.*关闭/ : minimized ? /展开.*语言修图|恢复.*语言修图/ : /最小化.*语言修图/;
    const named = button.and(s.page.getByRole('button', { name }));
    expect(await named.count(), `PRODUCT_ACCESSIBLE_NAME_MISSING: ${kind}; frozen header buttons are unnamed`).toBe(1);
    await reach(s, button, false);
  }
}
async function tools(s: Session, narrow: boolean): Promise<void> {
  for (const label of ['画笔', '橡皮', '撤销', '清除']) {
    const button = panel(s).getByRole('button', { name: label, exact: true });
    await reach(s, button, label === '撤销'); await singleLine(button);
  }
  const slider = panel(s).locator('input[type="range"]'); await reach(s, slider, false);
  if (narrow) {
    // Measure every row in the same scroll position; centering each control
    // separately must not erase the native vertical difference between rows.
    const boxes = await Promise.all(['画笔', '橡皮', '撤销', '清除'].map(label => rect(panel(s).getByRole('button', { name: label, exact: true }))));
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThanOrEqual(1);
    expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
    expect((await rect(slider)).y).toBeGreaterThanOrEqual(Math.max(...boxes.map(box => box.y + box.height)));
  }
}
async function chooseSecond(s: Session, count: number): Promise<void> {
  for (const kind of ['image', 'llm'] as const) {
    const trigger = modelTrigger(s, kind); await reach(s, trigger, false); await trigger.click(); await settle(s);
    const options = panel(s).locator('button').filter({ hasText: kind === 'image' ? IMAGE_NAME : LLM_NAME })
      .filter({ hasNot: s.page.locator('svg.lucide-chevron-down, svg.lucide-chevron-up') });
    if (await options.count() !== 2) throw new Error(`FIXTURE_MODEL_OPTIONS: ${kind} expected two provider pairs`);
    for (const provider of PROVIDERS) await reach(s, options.filter({ hasText: provider.name }), false);
    const option = options.filter({ hasText: PROVIDERS[1].name }); await option.click(); await settle(s);
    expect(await trigger.textContent()).toContain(PROVIDERS[1].name);
  }
  for (const [label, value] of [['画面比例', '4:3'], ['图片质量', 'medium'], ['生图数量', String(count)]]) {
    const select = param(s, label); await reach(s, select, false); await select.selectOption(value);
    expect(await select.inputValue()).toBe(value);
  }
  s.plan.count = count;
  await prompt(s).fill(PROMPT); await settle(s);
}
async function retained(s: Session, count: number, withReference: boolean): Promise<void> {
  expect(await prompt(s).inputValue()).toBe(PROMPT);
  for (const kind of ['image', 'llm'] as const) expect(await modelTrigger(s, kind).textContent()).toContain(PROVIDERS[1].name);
  expect(await s.page.evaluate(() => localStorage.getItem('wujie_edit_selected_model'))).toBe(`server::${PROVIDERS[1].id}::${MODEL_ID}`);
  expect(await s.page.evaluate(() => localStorage.getItem('wujie_edit_selected_llm'))).toBe(`server::${PROVIDERS[1].id}::${LLM_ID}`);
  expect(await param(s, '画面比例').inputValue()).toBe('4:3');
  expect(await param(s, '图片质量').inputValue()).toBe('medium');
  expect(await param(s, '生图数量').inputValue()).toBe(String(count));
  expect(await panel(s).getByRole('img', { name: '编辑', exact: true }).getAttribute('src')).toBe(s.media.original);
  if (withReference) expect(await panel(s).getByRole('img', { name: '参考1', exact: true }).getAttribute('src')).toBe(s.media.reference);
}
async function submit(s: Session): Promise<void> {
  const button = panel(s).getByRole('button', { name: '开始修改', exact: true }); await reach(s, button, false, 200);
  await Promise.all([
    s.page.waitForRequest(request => request.method() === 'POST' && request.url() === `${ORIGIN}/api/edit`),
    s.page.waitForRequest(request => request.method() === 'POST' && request.url() === `${ORIGIN}/api/poll-task`),
    button.click(),
  ]);
  await settle(s);
  expect(s.submissions).toHaveLength(1); expect(s.submissions[0]).toEqual(expectedSubmission(s));
  expect(s.released).toBe(false);
}
async function processing(s: Session): Promise<void> {
  const loading = panel(s).getByRole('button', { name: '修改中...', exact: true }); await reach(s, loading, true, 200);
  const region = resultRegion(s); await unique(region); await noHorizontalOverflow(s, region);
  const card = region.getByText(/^生成中 /).first().locator('xpath=..');
  await card.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(s); await within(s, card, 200);
  const progress = region.getByText(/^进度 \d+%$/); await unique(progress);
  await progress.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(s); await within(s, progress);
  await reach(s, region.getByRole('button', { name: '取消', exact: true }), false);
  expect(s.released).toBe(false); expect(s.submissions).toHaveLength(1);
}
async function maskSnapshot(s: Session): Promise<{ png: string; painted: number; width: number; height: number }> {
  const canvas = panel(s).locator('canvas'); await unique(canvas);
  return canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement; const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('FIXTURE_CANVAS_CONTEXT_MISSING');
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let painted = 0;
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i] > 10) painted++;
    return { png: canvas.toDataURL('image/png'), painted, width: canvas.width, height: canvas.height };
  });
}

describe('mobile image-editor layout', () => {
  for (const theme of ['gold', 'monochrome'] as const) {
    it.each(VIEWPORTS)(`${theme} keeps empty workspace tools parameters and actions reachable at %ix%i`, async (width, height) => {
      await withSession(async s => {
        await mount(s, theme, width, height, false); await bounds(s, width, height); await headerChecks(s);
        const empty = panel(s).getByRole('button', { name: /添加要修图的图片/ }); await reach(s, empty, false, 200);
        expect((await rect(empty)).height).toBeGreaterThanOrEqual(200);
        await tools(s, width <= 430);
        await reach(s, prompt(s), false, 200);
        // Original disabled expression is loading/blank prompt/no model, not
        // !image. Check blank-prompt disabled before filling; never bypass it.
        await reach(s, panel(s).getByRole('button', { name: '开始修改', exact: true }), true, 200);
        await chooseSecond(s, 2);
        await reach(s, panel(s).getByRole('button', { name: '开始修改', exact: true }), false, 200);
        expect(s.submissions).toHaveLength(0); await bounds(s, width, height);
      });
    }, 10000);

    for (const mode of ['processing', 'one-result', 'multiple-results'] as const) {
      it(`${theme} keeps ${mode} content and original task actions reachable`, async () => {
        await withSession(async s => {
          await mount(s, theme, 375, 812, true); await bounds(s, 375, 812);
          const count = mode === 'one-result' ? 1 : 2;
          await chooseSecond(s, count); await submit(s);
          if (mode === 'processing') { await processing(s); await retained(s, count, false); }
          else {
            s.release('completed');
            await s.page.waitForFunction(count => Array.from(document.querySelectorAll<HTMLImageElement>('img'))
              .filter(image => /^结果 \d+$/.test(image.alt) && image.complete && image.naturalWidth === 64).length === count, count);
            await settle(s);
            const region = resultRegion(s); await noHorizontalOverflow(s, region);
            for (let i = 0; i < count; i++) {
              const image = region.getByRole('img', { name: `结果 ${i + 1}`, exact: true });
              expect(await image.getAttribute('src')).toBe(s.media.results[i]);
              await image.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
              await settle(s); await within(s, image, 200);
              const box = await rect(image); expect(box.width).toBeLessThanOrEqual(343);
            }
            const confirm = region.getByRole('button', { name: /^确认使用/ }); await reach(s, confirm, false);
            await confirm.click(); await settle(s);
            const state = await s.page.evaluate(() => window.imageEditorFixture.state);
            expect(state.confirms).toEqual(s.media.results.slice(0, count).map(url => ({ url, prompt: `离线原图 + ${PROMPT}`, aspectRatio: '4:3' })));
            expect(state.closes).toBe(1); expect(s.cancels).toEqual([]);
          }
          expect(s.submissions).toHaveLength(1); expect(s.submissions[0]).toEqual(expectedSubmission(s));
          await bounds(s, 375, 812);
        });
      }, 10000);
    }

    it(`${theme} retains painted pixels reference prompt and exact pairs after edge drag minimize resize keyboard restore`, async () => {
      await withSession(async s => {
        await mount(s, theme, 1440, 900, true); await chooseSecond(s, 2);
        const picker = panel(s).getByRole('button', { name: '画布选图', exact: true }); await reach(s, picker, false); await picker.click();
        const reference = panel(s).getByRole('button', { name: /离线参考图/ }); await reach(s, reference, false); await reference.click(); await settle(s);
        const canvas = panel(s).locator('canvas');
        await canvas.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' })); await settle(s);
        const before = await maskSnapshot(s); expect(before.painted).toBe(0);
        const box = await rect(canvas); await within(s, canvas, 200);
        await s.page.mouse.move(box.x + 60, box.y + 70); await s.page.mouse.down(); await settle(s);
        await s.page.mouse.move(box.x + 120, box.y + 110, { steps: 8 }); await s.page.mouse.up(); await settle(s);
        const painted = await maskSnapshot(s); expect(painted.painted).toBeGreaterThan(0); expect(painted.png).not.toBe(before.png);
        await reach(s, panel(s).getByRole('button', { name: '撤销', exact: true }), false);
        await retained(s, 2, true);
        const drag = await rect(header(s));
        await s.page.mouse.move(drag.x + 20, drag.y + drag.height / 2); await s.page.mouse.down(); await settle(s);
        await s.page.mouse.move(1430, 890, { steps: 4 }); await s.page.mouse.up(); await settle(s);
        // Assert actual drag geometry before any subsequent click can time out.
        await bounds(s, 1440, 900);
        await reach(s, headerControl(s, 'minimize'), false); await headerControl(s, 'minimize').click(); await settle(s);
        await viewport(s, 375, 812);
        await s.page.evaluate(() => window.imageEditorFixture.viewport(375, 320, 0, 70));
        await bounds(s, 375, 320, 0, 70); await headerChecks(s, true);
        await headerControl(s, 'minimize').click(); await settle(s);
        await bounds(s, 375, 320, 0, 70); await headerChecks(s);
        expect(await maskSnapshot(s)).toEqual(painted); await retained(s, 2, true);
        await reach(s, panel(s).getByRole('button', { name: '撤销', exact: true }), false);
        await reach(s, prompt(s), false, 200);
        for (const label of ['画面比例', '图片质量', '生图数量']) await reach(s, param(s, label), false);
        await s.page.evaluate(() => window.imageEditorFixture.viewport(375, 812));
        await bounds(s, 375, 812); await headerChecks(s); await retained(s, 2, true);
        expect(await maskSnapshot(s)).toEqual(painted);
        const undo = panel(s).getByRole('button', { name: '撤销', exact: true }); await reach(s, undo, false); await undo.click(); await settle(s);
        expect(await maskSnapshot(s)).toEqual(before); expect(await undo.isDisabled()).toBe(true);
        expect(s.submissions).toHaveLength(0); expect(s.cancels).toEqual([]);
      });
    }, 10000);

    it(`${theme} preserves close versus cancel semantics across two isolated pending mounts`, async () => {
      // Each withSession drains/unmounts/disconnects/closes before the next
      // independent page mounts. No task/model/storage leakage across halves.
      await withSession(async s => {
        await mount(s, theme, 1440, 900, true); await chooseSecond(s, 2); await submit(s);
        await viewport(s, 375, 812); await bounds(s, 375, 812);
        await reach(s, headerControl(s, 'minimize'), false); await headerControl(s, 'minimize').click(); await settle(s);
        await bounds(s, 375, 812); await headerControl(s, 'minimize').click(); await settle(s);
        await bounds(s, 375, 812); await retained(s, 2, false); await processing(s);
        // Recheck after restore, immediately before close, with the poll held.
        expect(await panel(s).getByRole('button', { name: '修改中...', exact: true }).isDisabled()).toBe(true);
        expect(s.submissions).toHaveLength(1); expect(s.released).toBe(false); expect(s.terminalServed).toBe(false);
        const close = headerControl(s, 'close'); await reach(s, close, false); await close.click(); await settle(s);
        expect((await s.page.evaluate(() => window.imageEditorFixture.state)).closes).toBe(1);
        expect(s.cancels).toEqual([]); expect(s.submissions).toHaveLength(1); expect(s.released).toBe(false);
      });
      await withSession(async s => {
        await mount(s, theme, 375, 812, true); await bounds(s, 375, 812);
        await chooseSecond(s, 2); await submit(s); await processing(s);
        const cancel = resultRegion(s).getByRole('button', { name: '取消', exact: true }); await reach(s, cancel, false);
        await Promise.all([s.page.waitForResponse(response => response.url() === `${ORIGIN}/api/cancel-task` && response.request().method() === 'POST'), cancel.click()]);
        await s.page.waitForFunction(error => document.body.textContent?.includes(error), TERMINAL_ERROR); await settle(s);
        expect(s.cancels).toEqual([TASK_ID]); expect(s.submissions).toHaveLength(1);
        expect((await s.page.evaluate(() => window.imageEditorFixture.state)).closes).toBe(0);
        expect(await panel(s).getByRole('button', { name: '开始修改', exact: true }).isDisabled()).toBe(false);
      });
    }, 10000);
  }
});

// Task4 review round 1: append only. The preceding 37749 bytes are frozen.
// These checks have no execution admission until the controller reviews them.
type ImageEditorReviewMode = 'processing' | 'one-result' | 'multiple-results';

async function reviewDesktopGeometry(s: Session): Promise<void> {
  await bounds(s, 1440, 900);
  const result = resultRegion(s); await within(s, result, 200);
  const mainBox = await rect(panel(s)); const resultBox = await rect(result);
  expect(resultBox.x - mainBox.x - mainBox.width).toBeGreaterThanOrEqual(16);
  expect(resultBox.x - mainBox.x - mainBox.width).toBeLessThanOrEqual(24);
  expect(await result.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  await noHorizontalOverflow(s, result);
}

async function reviewPointHits(s: Session, target: Locator, x: number, y: number): Promise<void> {
  await within(s, target);
  const hits = await target.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && (hit === element || element.contains(hit));
  }, { x, y });
  expect(hits, 'PRODUCT_HIT_TARGET: the actual input/control must receive the native pointer').toBe(true);
}

async function reviewReach(s: Session, target: Locator): Promise<void> {
  await unique(target);
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(s); await within(s, target);
  expect(await target.isDisabled()).toBe(false);
  const box = await rect(target);
  await reviewPointHits(s, target, box.x + box.width / 2, box.y + box.height / 2);
  // A fixed result can paint outside the main scroll ancestor. Native hit
  // testing and actionability, not an overflow-only ancestor intersection,
  // decide whether its cancel/confirm control is actually reachable.
  await target.click({ trial: true });
}

async function reviewWaitForResults(s: Session, count: number): Promise<void> {
  await s.page.waitForFunction(expected => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
      .filter(image => /^结果 \d+$/.test(image.alt));
    return images.length === expected && images.every(image => image.complete && image.naturalWidth === 64);
  }, count);
  await settle(s);
  for (let i = 0; i < count; i++) {
    const image = resultRegion(s).getByRole('img', { name: `结果 ${i + 1}`, exact: true });
    await unique(image); expect(await image.getAttribute('src')).toBe(s.media.results[i]);
  }
}

async function reviewSessionRetained(s: Session, count: number, completed: boolean): Promise<void> {
  expect(s.submissions).toEqual([expectedSubmission(s)]);
  expect(await prompt(s).inputValue()).toBe(PROMPT);
  for (const kind of ['image', 'llm'] as const) {
    expect(await modelTrigger(s, kind).textContent()).toContain(PROVIDERS[1].name);
  }
  expect(await s.page.evaluate(() => localStorage.getItem('wujie_edit_selected_model'))).toBe(`server::${PROVIDERS[1].id}::${MODEL_ID}`);
  expect(await s.page.evaluate(() => localStorage.getItem('wujie_edit_selected_llm'))).toBe(`server::${PROVIDERS[1].id}::${LLM_ID}`);
  for (const [label, value] of [['画面比例', '4:3'], ['图片质量', 'medium'], ['生图数量', String(count)]]) {
    expect(await param(s, label).inputValue()).toBe(value);
  }
  // Completed edits intentionally replace the preview with the first result;
  // the original retained() helper is only suitable for an unfinished edit.
  expect(await panel(s).getByRole('img', { name: '编辑', exact: true }).getAttribute('src'))
    .toBe(completed ? s.media.results[0] : s.media.original);
  const state = await s.page.evaluate(() => window.imageEditorFixture.state);
  expect(state.params.at(-1)).toEqual({ aspectRatio: '4:3', quality: 'medium', count });
  expect(state.closes).toBe(0); expect(state.confirms).toEqual([]); expect(s.cancels).toEqual([]);
}

async function reviewResultContent(s: Session, mode: ImageEditorReviewMode, count: number): Promise<void> {
  // Scroll the real form as well as the result content. No value is changed.
  await reach(s, param(s, '生图数量'), false);
  const result = resultRegion(s); await unique(result);
  if (mode === 'processing') {
    const loading = panel(s).getByRole('button', { name: '修改中...', exact: true });
    await reach(s, loading, true, 200);
    const card = result.getByText(/^生成中 /).first().locator('xpath=..');
    await card.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await settle(s); await within(s, card, 200);
    const progress = result.getByText(/^进度 \d+%$/); await unique(progress);
    await progress.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await settle(s); await within(s, progress);
    await reviewReach(s, result.getByRole('button', { name: '取消', exact: true }));
    expect(s.released).toBe(false); expect(s.terminalServed).toBe(false);
  } else {
    for (let i = 0; i < count; i++) {
      const image = result.getByRole('img', { name: `结果 ${i + 1}`, exact: true });
      await unique(image); expect(await image.getAttribute('src')).toBe(s.media.results[i]);
      await image.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await settle(s); await within(s, image, 200);
      // The real result card owns its overlay and click handler; an overlay
      // descendant may legitimately be the native hit above the img itself.
      const box = await rect(image);
      await reviewPointHits(s, image.locator('xpath=..'), box.x + box.width / 2, box.y + box.height / 2);
    }
    await reviewReach(s, result.getByRole('button', { name: /^确认使用/ }));
    expect(s.released).toBe(true);
  }
  await noHorizontalOverflow(s, result);
  await reviewSessionRetained(s, count, mode !== 'processing');
}

describe('mobile image-editor review', () => {
  for (const theme of ['gold', 'monochrome'] as const) {
    it(`${theme} gives four tools and the real slider a 44px operable hit area`, async () => {
      await withSession(async s => {
        await mount(s, theme, 375, 812, true); await bounds(s, 375, 812);
        for (const name of ['画笔', '橡皮', '撤销', '清除']) {
          const button = panel(s).getByRole('button', { name, exact: true });
          await reach(s, button, name === '撤销');
          const box = await rect(button);
          expect(box.width, `PRODUCT_TOOL_HIT_WIDTH: ${name}`).toBeGreaterThanOrEqual(44);
          expect(box.height, `PRODUCT_TOOL_HIT_HEIGHT: ${name}`).toBeGreaterThanOrEqual(44);
        }
        const slider = panel(s).locator('input[type="range"]'); await reach(s, slider, false);
        expect(await slider.getAttribute('min')).toBe('10'); expect(await slider.getAttribute('max')).toBe('50');
        expect(await slider.inputValue()).toBe('20');
        const box = await rect(slider);
        expect(box.width, 'PRODUCT_SLIDER_HIT_WIDTH: measure the input, not a wrapper').toBeGreaterThanOrEqual(44);
        expect(box.height, 'PRODUCT_SLIDER_HIT_HEIGHT: the thin track is not the hit area').toBeGreaterThanOrEqual(44);
        // Above/below the center line, inside the actual input. Do not require
        // a 44px thumb or a thick track, and never dispatch/fill a fake change.
        let previous = Number(await slider.inputValue());
        for (const point of [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }]) {
          const x = box.x + box.width * point.x; const y = box.y + box.height * point.y;
          expect(await slider.isDisabled()).toBe(false);
          await reviewPointHits(s, slider, x, y);
          await slider.click({ trial: true, position: { x: box.width * point.x, y: box.height * point.y } });
          await s.page.mouse.click(x, y); await settle(s);
          const value = Number(await slider.inputValue());
          expect(value).toBeGreaterThanOrEqual(10); expect(value).toBeLessThanOrEqual(50);
          expect(value, 'PRODUCT_SLIDER_NATIVE_CHANGE: both off-center clicks must change the value').not.toBe(previous);
          if (point.x === 0.8) expect(value).toBeGreaterThan(previous);
          // Native value plus the rendered value proves the original React
          // onChange ran, rather than just changing an uncontrolled DOM value.
          expect(await slider.locator('xpath=..').getByText(String(value), { exact: true }).count()).toBe(1);
          previous = value;
        }
        expect(s.submissions).toHaveLength(0); expect(s.cancels).toEqual([]);
      });
    }, 10000);

    it(`${theme} constrains an active drag after held generation becomes multiple results`, async () => {
      await withSession(async s => {
        await mount(s, theme, 1440, 900, true); await chooseSecond(s, 2); await submit(s);
        await reviewDesktopGeometry(s);
        expect((await rect(resultRegion(s))).width).toBe(380);
        expect(s.released).toBe(false); await reviewSessionRetained(s, 2, false);
        const grip = await rect(header(s));
        try {
          await s.page.mouse.move(grip.x + 20, grip.y + grip.height / 2);
          await s.page.mouse.down(); await settle(s);
          // Stay pressed through the real completion and 380 -> 440 resize.
          s.release('completed'); await reviewWaitForResults(s, 2);
          expect((await rect(resultRegion(s))).width).toBe(440);
          await s.page.mouse.move(1432, 892, { steps: 4 }); await settle(s);
          await reviewSessionRetained(s, 2, true);
          // These actual bounds must fail as product assertions before any
          // subsequent click/actionability check could time out offscreen.
          await reviewDesktopGeometry(s);
        } finally { await s.page.mouse.up(); await settle(s); }
        await reviewDesktopGeometry(s);
        const stoppedMain = await rect(panel(s)); const stoppedResult = await rect(resultRegion(s));
        await s.page.mouse.move(30, 40, { steps: 2 }); await settle(s);
        expect(await rect(panel(s))).toEqual(stoppedMain);
        expect(await rect(resultRegion(s))).toEqual(stoppedResult);
        await reviewSessionRetained(s, 2, true);
      });
    }, 10000);

    for (const mode of ['processing', 'one-result', 'multiple-results'] as const) {
      it(`${theme} keeps desktop ${mode} and the same result node through an offset narrow visual viewport`, async () => {
        await withSession(async s => {
          await mount(s, theme, 1440, 900, true);
          const count = mode === 'one-result' ? 1 : 2;
          await chooseSecond(s, count); await submit(s);
          if (mode !== 'processing') { s.release('completed'); await reviewWaitForResults(s, count); }
          await reviewDesktopGeometry(s); await reviewResultContent(s, mode, count);
          await reviewDesktopGeometry(s);
          const result = resultRegion(s); const resultNode = await result.elementHandle();
          if (!resultNode) throw new Error('FIXTURE_REVIEW_RESULT_HANDLE_MISSING');
          try {
            const originalVisual = await s.page.evaluateHandle(() => window.visualViewport);
            try {
              // Keep the real layout viewport unchanged at 1440x900. Use the
              // original harness's SAME public VV object and its real events.
              await s.page.evaluate(() => window.imageEditorFixture.viewport(375, 650, 80, 70));
              expect(s.page.viewportSize()).toEqual({ width: 1440, height: 900 });
              expect(await s.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 1440, height: 900 });
              expect(await s.page.evaluate(original => window.visualViewport === original, originalVisual)).toBe(true);
              expect(await s.page.evaluate(() => ({ width: visualViewport!.width, height: visualViewport!.height,
                left: visualViewport!.offsetLeft, top: visualViewport!.offsetTop })))
                .toEqual({ width: 375, height: 650, left: 80, top: 70 });
              await bounds(s, 375, 650, 80, 70);
              expect(await result.evaluate((element, original) => element === original && original.isConnected, resultNode)).toBe(true);
              expect(await result.evaluate(element => getComputedStyle(element).position)).not.toBe('fixed');
              expect(await panel(s).evaluate((element, node) => element.contains(node), resultNode)).toBe(true);
              await result.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
              await settle(s); await within(s, result, 200);
              await reviewResultContent(s, mode, count); await bounds(s, 375, 650, 80, 70);
              await s.page.evaluate(() => window.imageEditorFixture.viewport(1440, 900));
              expect(s.page.viewportSize()).toEqual({ width: 1440, height: 900 });
              expect(await s.page.evaluate(() => ({ width: visualViewport!.width, height: visualViewport!.height,
                left: visualViewport!.offsetLeft, top: visualViewport!.offsetTop })))
                .toEqual({ width: 1440, height: 900, left: 0, top: 0 });
              expect(await s.page.evaluate(original => window.visualViewport === original, originalVisual)).toBe(true);
              expect(await result.evaluate((element, original) => element === original && original.isConnected, resultNode)).toBe(true);
              await reviewDesktopGeometry(s); await reviewResultContent(s, mode, count);
              await reviewDesktopGeometry(s);
              expect(s.submissions).toHaveLength(1);
              if (mode === 'processing') { expect(s.released).toBe(false); expect(s.terminalServed).toBe(false); }
            } finally { await originalVisual.dispose(); }
          } finally { await resultNode.dispose(); }
        });
      }, 10000);
    }
  }
});
