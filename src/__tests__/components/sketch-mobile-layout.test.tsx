// @vitest-environment jsdom
import React from 'react';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SketchToCodePanel } from '@/components/sketch-to-code-panel';
import { createSketchPanelSession, type SketchScope } from '@/lib/sketch-to-code/client';
import { createSketchImagePanelSession } from '@/lib/sketch-to-code/image-client';
import { appendSketchStroke } from '@/lib/sketch-to-code/drawing';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

// Real sessions and components; only missing canvas/pointer APIs and transport
// are synthetic. The browser receives snapshots solely for real CSS geometry.
const vision: TaskModelDescriptor = { providerId: 'vision-a', modelId: 'same-model', kind: 'chat', sourceType: 'chat',
  protocol: 'chat-completions', executionMode: 'sync', supportsVision: true, allowedRatios: [], allowedSizes: [],
  qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: [], capabilitySources: {} };
const image: TaskModelDescriptor = { ...vision, providerId: 'image-a', kind: 'image', sourceType: 'image',
  supportsReferenceImages: true, maxReferenceImages: 1, supportedOperations: ['image-to-image'], outputKinds: ['image'],
  allowedRatios: ['4:3'], allowedSizes: ['1024'], qualityOptions: ['standard'] };
const options = [
  { id: 'same-model', providerId: 'vision-a', providerName: '视觉供应商甲', type: 'chat' as const, name: '管理员视觉名称' },
  { id: 'same-model', providerId: 'image-a', providerName: '图像供应商甲', type: 'image' as const, name: '管理员图像名称' },
];
let browser: Browser;
let page: Page;
let css: string;
beforeAll(async (): Promise<void> => {
  const require = createRequire(import.meta.url);
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), {
    base: process.cwd(), loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles([{ content: await readFile(path.resolve('src/components/sketch-to-code-panel.tsx'), 'utf8'), extension: 'tsx' }]));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.route('**/*', route => route.abort());
}, 30000);
beforeEach((): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  }) as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1024, bottom: 768, width: 1024, height: 768, toJSON: () => ({}) });
});
afterEach((): void => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async (): Promise<void> => { await browser?.close(); });

function fixture(width: number, height: number, mode: 'image' | 'code', recovering = false): {
  view: ReturnType<typeof render>; session: ReturnType<typeof createSketchPanelSession>;
  imageSession: ReturnType<typeof createSketchImagePanelSession>; fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
} {
  Object.defineProperties(window, { innerWidth: { configurable: true, value: width }, innerHeight: { configurable: true, value: height } });
  const fetcher = vi.fn<typeof fetch>(async (url, init): Promise<Response> => {
    if (String(url) === '/api/tasks/recover?projectId=project-a' && init?.method === 'GET') return Response.json({ success: true, tasks: recovering ? [
      { id: 'active-task', projectId: 'project-a', type: mode === 'image' ? 'sketch-to-image' : 'sketch-to-code', status: 'processing', createdAt: 1, updatedAt: 2 },
    ] : [] });
    return Response.json({ success: false, error: 'UNEXPECTED_SYNTHETIC_REQUEST' }, { status: 409 });
  });
  vi.stubGlobal('fetch', fetcher);
  const scope: SketchScope = { actorId: 'actor-a', projectId: 'project-a', key: 'mobile-layout', authority: 'legacy', assertCurrent: (): void => {} };
  const session = createSketchPanelSession(scope), imageSession = createSketchImagePanelSession(scope);
  session.history = appendSketchStroke(session.history, { id: 'original', tool: 'pen', color: '#111827', width: 5, points: [{ x: 10, y: 20 }] });
  session.selection = '["vision-a","same-model"]'; session.instruction = '保留页面说明';
  imageSession.visionSelection = '["vision-a","same-model"]'; imageSession.imageSelection = '["image-a","same-model"]'; imageSession.instruction = '保留创作关键词';
  const view = render(<SketchToCodePanel session={session} imageSession={imageSession} models={[vision, image]} modelOptions={options} recoverTasks={recovering} isMonochrome={mode === 'code'} />);
  if (mode === 'code') fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
  return { view, session, imageSession, fetcher };
}
async function layout(container: HTMLElement, width: number, height: number): Promise<void> {
  await act(async (): Promise<void> => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<style>${css}</style>${container.innerHTML}`);
  });
}
async function inside(width: number, height: number): Promise<void> {
  for (const locator of [page.getByRole('region', { name: '草图创作', exact: true }), page.getByRole('button', { name: '关闭草图创作' }), page.getByRole('button', { name: '最小化草图窗口' })]) {
    const rect = await locator.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width); expect(rect!.y + rect!.height).toBeLessThanOrEqual(height);
  }
}
async function drawingFirst(width: number, height: number): Promise<void> {
  const canvas = page.getByLabel('绘图区');
  expect(await canvas.count()).toBe(1);
  expect(await canvas.getAttribute('width')).toBe('1024'); expect(await canvas.getAttribute('height')).toBe('768');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y, 'drawing must start in the first 40%').toBeLessThanOrEqual(height * 0.4);
  expect(bounds!.y + bounds!.height, 'whole drawing must be visible').toBeLessThanOrEqual(height - 8);
  expect(bounds!.width, 'do not shrink the whiteboard to a token preview').toBeGreaterThanOrEqual(width - 48);
  expect(Math.abs(bounds!.height / bounds!.width - 0.75)).toBeLessThan(0.01);
  const visible = await canvas.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return [document.elementFromPoint(rect.left + 2, rect.top + 2), document.elementFromPoint(rect.right - 2, rect.bottom - 2)].every(hit => hit === element);
  });
  expect(visible, 'whiteboard corners must not be clipped or covered').toBe(true);
  await inside(width, height);
}
function noGeneration(f: ReturnType<typeof fixture>): void {
  expect(f.fetcher.mock.calls.filter(([url]) => ['/api/sketch-to-code', '/api/sketch-to-image'].includes(String(url)))).toHaveLength(0);
}
describe('mobile drawing-first layout', () => {
  for (const mode of ['image', 'code'] as const) {
    it.each([[320, 640], [360, 640], [390, 780]])(`${mode} first open %ix%i`, async (width, height): Promise<void> => {
      const f = fixture(width, height, mode);
      await layout(f.view.container, width, height); await drawingFirst(width, height); noGeneration(f);
      expect(f.session.history.present).toMatchObject({ width: 1024, height: 768 });
    });
    it(`${mode} active recovery stays visible and blocks admission`, async (): Promise<void> => {
      const f = fixture(390, 780, mode, true);
      await waitFor(() => expect(screen.queryByRole('button', { name: /active-task/ })).not.toBeNull());
      expect(screen.getByText('原任务待核对，暂不能新生成。')).toBeTruthy();
      const generate = screen.getByRole('button', { name: mode === 'image' ? '生成图像' : '生成代码' });
      expect(generate).toHaveProperty('disabled', true); fireEvent.click(generate); noGeneration(f);
      expect(f.fetcher.mock.calls.map(([url]) => String(url))).toEqual(['/api/tasks/recover?projectId=project-a']);
      await layout(f.view.container, 390, 780); await drawingFirst(390, 780);
      const recovery = await page.getByRole('button', { name: '查看原任务' }).boundingBox();
      expect(recovery).not.toBeNull(); expect(recovery!.y).toBeGreaterThanOrEqual(0); expect(recovery!.y + recovery!.height).toBeLessThanOrEqual(780);
      expect(await page.getByText('原任务待核对，暂不能新生成。').isVisible()).toBe(true);
      for (const label of mode === 'image' ? ['视觉分析模型', '图像生成模型'] : ['视觉模型']) {
        const select = screen.getByLabelText(label) as HTMLSelectElement;
        expect(select.selectedOptions[0].text).toBe(label === '图像生成模型' ? '图像供应商甲 / 管理员图像名称' : '视觉供应商甲 / 管理员视觉名称');
      }
    });
    it(`${mode} desktop preserves drawing and parameter columns`, async (): Promise<void> => {
      const f = fixture(1440, 900, mode); await layout(f.view.container, 1440, 900);
      const drawing = await page.getByLabel('绘图区').boundingBox();
      const parameter = await page.getByLabel(mode === 'image' ? '创作关键词' : '页面说明').boundingBox();
      expect(parameter!.x).toBeGreaterThan(drawing!.x + drawing!.width);
      for (const label of ['#111827', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'].map(value => `画笔颜色 ${value}`).concat(['画笔粗细 2', '画笔粗细 5', '画笔粗细 10'])) {
        expect(await page.getByRole('button', { name: label, exact: true }).isVisible()).toBe(true);
      }
      await inside(1440, 900); noGeneration(f);
    });
  }
});
describe('mobile brush settings', () => {
  it('uses visible compact choices for the next real stroke and preserves sessions across minimize and modes', async (): Promise<void> => {
    const f = fixture(390, 780, 'image');
    const toggle = screen.queryByRole('button', { name: /画笔设置/ });
    expect(toggle, 'mobile settings need an explicit compact entry').not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    await layout(f.view.container, 390, 780);
    expect(await page.getByRole('group', { name: '画笔颜色' }).isVisible()).toBe(false);
    fireEvent.click(toggle!); expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '画笔颜色 #ef4444' }));
    fireEvent.click(screen.getByRole('button', { name: '画笔粗细 10' }));
    fireEvent.click(screen.getByRole('button', { name: '橡皮擦' })); fireEvent.click(toggle!);
    expect(screen.getByLabelText('当前绘图设置').textContent).toContain('橡皮擦 · 红色 · 10px');
    await layout(f.view.container, 390, 780);
    expect(await page.getByLabel('当前绘图设置').isVisible()).toBe(true);
    const canvas = screen.getByLabelText('绘图区') as HTMLCanvasElement;
    Object.defineProperties(canvas, { setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: (): boolean => false } });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 30, clientY: 40 });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 60 }); fireEvent.pointerUp(canvas);
    expect(f.session.history.present.strokes).toHaveLength(2);
    expect(f.session.history.present.strokes[1]).toMatchObject({ tool: 'eraser', color: '#ef4444', width: 10, points: [{ x: 30, y: 40 }, { x: 50, y: 60 }] });
    const history = f.session.history;
    fireEvent.click(screen.getByRole('button', { name: '最小化草图窗口' })); fireEvent.click(screen.getByRole('button', { name: '恢复草图窗口' }));
    fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect(screen.getByLabelText('页面说明')).toHaveProperty('value', '保留页面说明');
    expect(screen.getByLabelText('视觉模型')).toHaveProperty('value', '["vision-a","same-model"]');
    fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
    expect(screen.getByLabelText('创作关键词')).toHaveProperty('value', '保留创作关键词');
    expect(screen.getByLabelText('视觉分析模型')).toHaveProperty('value', '["vision-a","same-model"]');
    expect(screen.getByLabelText('图像生成模型')).toHaveProperty('value', '["image-a","same-model"]');
    expect(f.session.history).toBe(history); noGeneration(f);
  });
});
