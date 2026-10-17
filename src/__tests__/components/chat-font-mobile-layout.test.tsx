// @vitest-environment jsdom

import React from 'react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compile } from '@tailwindcss/node';
import { chromium, type Browser, type Page } from '@playwright/test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatArea from '@/components/simple-chat/chat-area';
import { ThemeProvider } from '@/components/simple-chat/theme-script';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import FontDesignPanel from '@/components/font-design-panel';

// Real components + the shipped stylesheet in an offline Chromium page. jsdom
// drives React events; Chromium supplies layout rather than invented rectangles.
const sizes = [[320, 640], [375, 667], [430, 932], [844, 390], [1440, 900]] as const;
const longModelName = '超长模型名称用于验证手机宽度不会撑开布局 GPT Image';
const task: SimpleChatTask = {
  id: 'layout-task', projectId: 'layout-project', name: '截图布局回归',
  model: 'offline-model', providerId: 'offline-provider', createdAt: 1, updatedAt: 1,
  messages: [{ id: 'message-1', role: 'assistant', content: '离线布局检查', createdAt: 1 }],
};
const project: SimpleChatProject = {
  id: 'layout-project', name: '测试项目', tasks: [task], agents: [], knowledgeItems: [], createdAt: 1, updatedAt: 1,
};
let browser: Browser;
let page: Page;
let stylesheet: Awaited<ReturnType<typeof compile>>;

function viewport(width: number, height: number): void {
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: width },
    innerHeight: { configurable: true, value: height },
  });
}

async function layout(container: HTMLElement, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  const candidates = [...new Set([...container.querySelectorAll('[class]')]
    .flatMap(element => [...element.classList]))];
  const snapshot = container.cloneNode(true) as HTMLElement;
  container.querySelectorAll('select').forEach((select, index) => {
    const clone = snapshot.querySelectorAll('select')[index];
    [...select.options].forEach((option, optionIndex) => {
      clone.options[optionIndex].toggleAttribute('selected', option.selected);
    });
  });
  await page.setContent(`<html class="${document.documentElement.className}"><style>${stylesheet.build(candidates)}</style>${snapshot.innerHTML}</html>`);
}

async function expectInside(selector: string, width: number, height?: number): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { text: element.getAttribute('title') || element.textContent, left: rect.left,
      right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.left, `${box.text}: left`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.text}: right`).toBeLessThanOrEqual(width);
    expect(box.width, `${box.text}: visible width`).toBeGreaterThan(0);
    if (height !== undefined) {
      expect(box.top, `${box.text}: top`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${box.text}: bottom`).toBeLessThanOrEqual(height);
    }
  }
}

async function measuredFontRect(): Promise<DOMRect> {
  const box = (await page.locator('[data-floating-panel]').boundingBox())!;
  return new DOMRect(box.x, box.y, box.width, box.height);
}

beforeAll(async () => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  stylesheet = await compile(await readFile(resolve('src/app/globals.css'), 'utf8'), {
    base: resolve('src/app'), onDependency: () => {},
  });
}, 30_000);

beforeEach(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); },
    clear: (): void => values.clear(),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const body = url.includes('/models') ? {
      models: [{ id: 'offline-model', name: longModelName, providerId: 'offline-provider' }],
      providers: [{ id: 'offline-provider', name: '离线测试' }],
    } : url === '/api/font-design/plan' ? {
      scenes: ['KV主标题', '商业海报', 'App图标', '文化艺术'].map(name => ({ id: name, name })),
      styleCategories: [{ id: 'smart-recommend', name: '智能推荐', subStyles: [] }],
    } : url === '/api/user-data/sync?key=projects' ? {
      success: true, value: [{ id: 'canvas-1', name: '一个名称很长的目标画布项目用于检查页尾布局' }],
    } : { skills: [], data: null, runs: [], tasks: [] };
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await browser?.close(); Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); });

describe('offline mobile layouts', () => {
  for (const theme of ['gold', 'monochrome'] as const) {
    for (const [width, height] of sizes) {
      it(`keeps the screenshot simple-chat composer and footer usable at ${width}x${height} (${theme})`, async () => {
        viewport(width, height);
        localStorage.setItem('simple-chat-theme', theme === 'gold' ? 'dark' : 'light');
        const view = render(<div style={{ width, height, display: 'flex', flexDirection: 'column' }}>
          <ThemeProvider><ChatArea user={{ id: 'layout-user', name: '离线用户', createdAt: 1, updatedAt: 1 }}
            project={project} task={task} onUpdateTask={vi.fn()} onPersistTask={async () => {}}
            onUpdateProject={vi.fn()} onCreateTask={vi.fn()} onSelectTask={vi.fn()}
            onUpdateAgent={vi.fn()} onDeleteAgent={vi.fn()} onSkillToAgent={vi.fn()}
            onLogout={vi.fn()} onBackToWorkspace={vi.fn()} sidebarOpen={false} onToggleSidebar={vi.fn()} /></ThemeProvider>
        </div>);
        const placeholder = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
        const textarea = screen.getByPlaceholderText(placeholder);
        fireEvent.change(textarea, { target: { value: '这是一段多行输入\n手机上文字和工具按钮必须各自占行' } });
        await act(async () => { await Promise.resolve(); });
        await layout(view.container, width, height);
        const tools = `textarea[placeholder="${placeholder}"] + div > button`;
        expect(await page.locator(tools).count(), 'all nine tools and send remain available').toBe(10);
        const textBox = (await page.getByPlaceholder(placeholder).boundingBox())!;
        for (const tool of await page.locator(tools).all()) {
          const box = (await tool.boundingBox())!;
          expect(box.y, 'tool row must start below the textarea').toBeGreaterThanOrEqual(textBox.y + textBox.height);
        }
        await expectInside(tools, width, height);
        await expectInside('select[aria-label="目标画布项目"]', width, height);
        for (const name of [theme === 'gold' ? '亮色模式' : '暗色模式', '临时聊天', '全局搜索']) {
          const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.y + box.height, `${name} stays above the viewport bottom`).toBeLessThanOrEqual(height);
        }
        const sendBox = await page.locator(`${tools}:last-child`).boundingBox();
        expect(Math.abs(textBox.x + textBox.width - sendBox!.x - sendBox!.width), 'wrapped send action stays at the trailing edge').toBeLessThanOrEqual(16);
      });

      it(`keeps the font window, heading, close and tabs within ${width}x${height} (${theme})`, async () => {
        viewport(width, height);
        const view = render(<FontDesignPanel isMonochrome={theme === 'monochrome'} onClose={vi.fn()} />);
        await act(async () => { await Promise.resolve(); });
        await layout(view.container, width, height);
        await expectInside('[data-floating-panel], h1, button[title="关闭"], button[title="最小化"]', width, height);
        await expectInside('[data-floating-panel] button', width);
        const overflow = await page.locator('[data-floating-panel]').evaluate(element => element.scrollWidth > element.clientWidth);
        expect(overflow, 'font window must not clip horizontal content').toBe(false);
        const input = page.getByPlaceholder('请输入中文标题、活动主题、封面标题或文字Logo名称');
        const results = page.getByText('系统将根据文字含义和风格偏好推荐设计方案');
        const inputBox = (await input.boundingBox())!;
        const resultBox = (await results.boundingBox())!;
        if (width < 768) expect(resultBox.y, 'mobile settings precede results in one scrolling column').toBeGreaterThan(inputBox.y);
        else expect(resultBox.x, 'desktop keeps settings and results side by side').toBeGreaterThan(inputBox.x + inputBox.width);
        await page.getByRole('button', { name: '历史记录', exact: true }).scrollIntoViewIfNeeded();
        await expectInside('button[title="关闭"]', width, height);
        const historyBox = (await page.getByRole('button', { name: '历史记录', exact: true }).boundingBox())!;
        expect(historyBox.y, 'last tab can be scrolled into view').toBeGreaterThanOrEqual(0);
        expect(historyBox.y + historyBox.height).toBeLessThanOrEqual(height);
      });
    }
  }

  it('constrains font dragging and reflows after resize, minimize and restore', async () => {
    viewport(1440, 900);
    const onClose = vi.fn();
    const view = render(<FontDesignPanel onClose={onClose} />);
    await act(async () => { await Promise.resolve(); });
    const panel = view.container.querySelector('[data-floating-panel]') as HTMLElement;
    const header = screen.getByRole('heading', { name: '字境大师 Pro' }).closest('div')!.parentElement!.parentElement!;
    await layout(view.container, 1440, 900);
    const initial = (await page.locator('[data-floating-panel]').boundingBox())!;
    let measured = await measuredFontRect();
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => measured);
    for (const [x, y] of [[-2000, -2000], [4000, 3000]]) {
      fireEvent.mouseDown(header, { button: 0, clientX: initial.x + 20, clientY: initial.y + 20 });
      fireEvent.mouseMove(window, { clientX: x, clientY: y });
      fireEvent.mouseUp(window);
      await layout(view.container, 1440, 900);
      measured = await measuredFontRect();
      await expectInside('[data-floating-panel], button[title="关闭"]', 1440, 900);
    }
    fireEvent.click(screen.getByTitle('最小化'));
    await layout(view.container, 1440, 900);
    measured = await measuredFontRect();
    viewport(320, 390);
    fireEvent(window, new Event('resize'));
    await layout(view.container, 320, 390);
    measured = await measuredFontRect();
    await expectInside('button[title="展开"], button[title="关闭"]', 320, 390);
    fireEvent.click(screen.getByTitle('展开'));
    await layout(view.container, 320, 390);
    await expectInside('[data-floating-panel], button[title="关闭"]', 320, 390);
    fireEvent.click(screen.getByTitle('关闭'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reclamps minimized font controls after the narrower viewport commits', async () => {
    // Measure both real committed header layouts, including responsive button
    // sizes and wrapped title/subtitle. No estimated minimized height is used.
    const minimizedRects = new Map<number, DOMRect>();
    for (const width of [1440, 280]) {
      viewport(width, 900);
      const fixture = render(<FontDesignPanel onClose={vi.fn()} />);
      await act(async () => { await Promise.resolve(); });
      fireEvent.click(fixture.getByTitle('最小化'));
      await layout(fixture.container, width, 900);
      const rect = await measuredFontRect();
      minimizedRects.set(rect.width, rect);
      fixture.unmount();
    }
    const [wide, narrow] = [...minimizedRects.values()];
    expect(narrow.height, 'narrow committed title/subtitle really wrap').toBeGreaterThan(wide.height);

    viewport(1440, 900);
    const onClose = vi.fn();
    const view = render(<FontDesignPanel onClose={onClose} />);
    await act(async () => { await Promise.resolve(); });
    const panel = view.container.querySelector('[data-floating-panel]') as HTMLElement;
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
      // Before React commits width, resize sees the old measured header. A
      // layout effect after commit sees the new measured header synchronously.
      const committed = minimizedRects.get(Number.parseFloat(panel.style.width));
      if (!committed) throw new Error('Missing browser measurement for committed width');
      return new DOMRect(Number.parseFloat(panel.style.left), Number.parseFloat(panel.style.top), committed.width, committed.height);
    });
    fireEvent.click(screen.getByTitle('最小化'));
    const header = screen.getByRole('heading', { name: '字境大师 Pro' }).closest('div')!.parentElement!.parentElement!;
    const startX = Number.parseFloat(panel.style.left) + 20;
    const startY = Number.parseFloat(panel.style.top) + 20;
    fireEvent.mouseDown(header, { button: 0, clientX: startX, clientY: startY });
    fireEvent.mouseMove(window, { clientX: startX, clientY: 2000 });
    fireEvent.mouseUp(window);
    await layout(view.container, 1440, 900);
    const parked = await measuredFontRect();
    expect(parked.bottom, 'minimized window starts at the bottom margin').toBeCloseTo(884, 1);

    viewport(280, 900);
    fireEvent(window, new Event('resize'));
    expect(screen.getByTitle('展开'), 'window stays minimized after resize').toBeTruthy();
    expect(screen.queryByTitle('最小化')).toBeNull();
    await layout(view.container, 280, 900);
    await expectInside('button[title="展开"], button[title="关闭"]', 280, 900);
    await expectInside('[data-floating-panel]', 280, 900);
    fireEvent.click(screen.getByTitle('关闭'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
