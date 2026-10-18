// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.example.test"}
import React from 'react';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { chromium, type Browser, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, User } from '@/lib/user-types';

// Replace only local persistence and HTTP boundaries; render the real dashboard.
const manager = vi.hoisted(() => ({
  getProjects: vi.fn<() => Project[]>(() => []), getUsageStats: vi.fn(() => []),
  getCurrentUserId: vi.fn(() => 'responsive-admin'),
}));
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => manager } }));
import DashboardView from '@/components/dashboard/dashboard-view';
import AdminTabs from '@/components/dashboard/admin-tabs';

const user: User = {
  id: 'responsive-admin', name: 'Dashboard Admin', password: '', role: 'admin',
  status: 'active', createdAt: 1, updatedAt: 1, productType: 'canvas',
};
const recentProjects: Project[] = [1, 2, 3].map(index => ({
  id: `recent-${index}`, userId: user.id, name: `最近项目${index}`,
  createdAt: index, updatedAt: index, canvasImages: [], settings: {},
}));
let browser: Browser;
let page: Page;
let css: string;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const files = ['dashboard-view.tsx', 'admin-tabs.tsx'];
  const sources = await Promise.all(files.map(file => readFile(path.resolve('src/components/dashboard', file), 'utf8')));
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
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.route('**/*', route => route.abort());
}, 30000);
beforeEach(() => {
  manager.getProjects.mockReturnValue([]);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/creative/health') return Response.json({
      success: true, name: 'Creative connector', version: '1.0', authRequired: false,
      hosts: { photoshopCep: true, illustratorCep: true },
      capabilities: { photoshop_generate_with_reference_image_and_preserve_all_original_layers: true },
    });
    return Response.json({ success: false });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
afterAll(async () => { await browser?.close(); });

function dashboard(): ReturnType<typeof render> {
  return render(<DashboardView user={user} onOpenProject={vi.fn()} onNewProject={vi.fn()} />);
}
function navigate(name: string): void {
  const trigger = screen.queryByRole('button', { name: '展开导航' });
  if (trigger) fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole('navigation', { hidden: true })).getByRole('button', { name: new RegExp(name) }));
}
async function show(container: HTMLElement, width: number, height: number = 900): Promise<void> {
  await act(async () => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<style>${css}</style>${container.innerHTML}`);
  });
}
async function expectContentFits(): Promise<void> {
  const sizes = await page.locator('main').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizes.scroll, 'dashboard content must fit instead of being clipped by the main overflow rule').toBeLessThanOrEqual(sizes.width + 1);
  const titles = await page.locator('h1').evaluateAll(elements => elements.map(element => ({
    height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight),
  })));
  for (const title of titles) expect(title.height, 'page title must remain on one line').toBeLessThanOrEqual(title.line + 1);
  const buttons = await page.locator('main button').evaluateAll(elements => elements.filter(element => element.textContent?.trim()).map(element => ({
    height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight),
    padding: parseFloat(getComputedStyle(element).paddingTop) + parseFloat(getComputedStyle(element).paddingBottom),
  })));
  for (const button of buttons) expect(button.height, 'action text must not wrap into a vertical column').toBeLessThanOrEqual(Math.max(44, button.line + button.padding + 2) + 1);
}

describe('mobile drawing-first layout dashboard touch', () => {
  it.each([320, 360, 390])('keeps search and primary actions at least 44px at %ipx', async width => {
    const view = dashboard();
    await show(view.container, width, 780);
    for (const target of [page.getByPlaceholder('搜索项目...'), ...['批量管理', '导入 .wujie', '新建项目', '全部', '最近', '收藏'].map(name => page.getByRole('button', { name, exact: true }))]) {
      expect(await target.isVisible()).toBe(true);
      const rect = await target.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.width).toBeGreaterThanOrEqual(44); expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(780);
    }
    await expectContentFits();
  });
});

describe('dashboard narrow screen regression', () => {
  it.each([[640, 320], [390, 240]])('I1: keeps navigation and close reachable with three recent projects at %ix%i', async (width, height) => {
    manager.getProjects.mockReturnValue(recentProjects);
    const view = dashboard();
    fireEvent.click(screen.getByRole('button', { name: '展开导航' }));
    await show(view.container, width, height);
    const aside = page.locator('aside');
    const nav = page.getByRole('navigation');
    for (const project of recentProjects) expect(await aside.getByText(project.name, { exact: true }).count()).toBe(1);
    const metrics = await aside.evaluate(element => ({
      asideHeight: element.clientHeight, navHeight: element.querySelector('nav')!.clientHeight,
      closeHeight: element.querySelector('button')!.getBoundingClientRect().height,
    }));
    console.info(`I1 ${width}x${height}: ${JSON.stringify(metrics)}`);
    expect(metrics.navHeight, 'navigation must retain a nonzero reachable area').toBeGreaterThan(0);
    await nav.getByRole('button', { name: /我的项目/ }).click({ trial: true, timeout: 1500 });
    const last = nav.getByRole('button', { name: /电商模板/ });
    await last.scrollIntoViewIfNeeded({ timeout: 1500 });
    await last.click({ trial: true, timeout: 1500 });
    expect(await aside.evaluate(element => element.scrollTop), 'mobile sidebar must scroll as a whole').toBeGreaterThan(0);
    // Actionability includes viewport clipping and hit testing; the sticky close
    // remains usable after scrolling all the way to the final admin destination.
    const close = page.getByRole('button', { name: '关闭导航', exact: true });
    const position = await close.boundingBox();
    expect(position!.y).toBeGreaterThanOrEqual(0);
    expect(position!.y + position!.height).toBeLessThanOrEqual(height);
    await close.click({ trial: true, timeout: 1500 });
  });

  it('I1: preserves independent desktop navigation scrolling with three recent projects', async () => {
    manager.getProjects.mockReturnValue(recentProjects);
    const view = dashboard();
    await show(view.container, 1440, 320);
    const nav = page.getByRole('navigation');
    const last = nav.getByRole('button', { name: /电商模板/ });
    await last.scrollIntoViewIfNeeded({ timeout: 1500 });
    await last.click({ trial: true, timeout: 1500 });
    expect(await nav.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('aside').evaluate(element => element.scrollTop)).toBe(0);
  });

  it.each(['我的项目', '用户管理'])('M1: returns focus to the mobile trigger after selecting %s', async name => {
    const view = dashboard();
    const trigger = screen.getByRole('button', { name: '展开导航' });
    await act(async () => { fireEvent.click(trigger); });
    const destination = within(screen.getByRole('navigation')).getByRole('button', { name: new RegExp(name) });
    destination.focus();
    expect(document.activeElement).toBe(destination);
    await act(async () => { fireEvent.click(destination); });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement, 'focus must leave the now-hidden navigation item').toBe(trigger);
    await show(view.container, 640, 320);
    expect(await page.locator('aside').isVisible()).toBe(false);
  });

  it.each(['我的项目', '用户管理'])('M1: keeps desktop destination focus when the mobile menu is closed: %s', async name => {
    const view = dashboard();
    const destination = within(screen.getByRole('navigation', { hidden: true })).getByRole('button', { name: new RegExp(name) });
    destination.focus();
    await act(async () => { fireEvent.click(destination); });
    expect(document.activeElement).toBe(destination);
    await show(view.container, 1440, 320);
    expect(await page.locator('aside').isVisible()).toBe(true);
  });

  it('offers a collapsed mobile navigation, explicit close, Escape, and collapses after choosing a destination', async () => {
    const view = dashboard();
    const trigger = screen.getByRole('button', { name: '展开导航' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await show(view.container, 390);
    expect(await page.locator('aside').isVisible()).toBe(false);
    expect(await page.locator('main').evaluate(element => element.clientWidth)).toBe(390);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await show(view.container, 390);
    expect(await page.locator('aside').isVisible()).toBe(true);
    const badge = page.getByText('管理员', { exact: true });
    expect(await badge.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(24);
    fireEvent.click(screen.getByRole('button', { name: '关闭导航' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    navigate('资产库');
    expect(screen.getByRole('heading', { name: '资产库' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    navigate('我的项目');
    expect(screen.getByRole('heading', { name: '我的项目' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    navigate('用户管理');
    expect(screen.getByRole('heading', { name: '用户管理' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it.each([320, 390, 768])('keeps project and asset headings and action labels readable at %ipx', async width => {
    const view = dashboard();
    await show(view.container, width);
    await expectContentFits();
    expect(await page.getByPlaceholder('搜索项目...').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
    navigate('资产库');
    await show(view.container, width);
    await expectContentFits();
  });

  it('preserves the desktop sidebar and horizontal project header', async () => {
    const view = dashboard();
    await show(view.container, 1440);
    expect(await page.locator('aside').isVisible()).toBe(true);
    expect(await page.locator('aside').evaluate(element => element.getBoundingClientRect().width)).toBe(260);
    expect(await page.getByRole('button', { name: '展开导航' }).isVisible()).toBe(false);
    const title = await page.getByRole('heading', { name: '我的项目' }).boundingBox();
    const input = await page.getByPlaceholder('搜索项目...').boundingBox();
    expect(Math.abs(title!.y - input!.y)).toBeLessThan(24);
  });

  it.each([320, 390])('wraps API actions within the page at %ipx without losing any action', async width => {
    const view = dashboard();
    navigate('API 管理');
    await show(view.container, width);
    await expectContentFits();
    for (const name of ['发布自检', '刷新余额', '刷新列表', '添加 API']) {
      const button = page.getByRole('button', { name, exact: true });
      expect(await button.isVisible()).toBe(true);
      expect(await button.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
    }
  });

  it.each([320, 390])('stacks plugin configuration and wraps full URLs and keys at %ipx', async width => {
    const view = dashboard();
    navigate('插件连接器');
    await waitFor(() => expect(screen.getByText('photoshop_generate_with_reference_image_and_preserve_all_original_layers')).toBeTruthy());
    await show(view.container, width);
    await expectContentFits();
    const address = page.getByText('http://127.0.0.1:5000', { exact: true });
    const auth = page.getByText('WUJIE_DCC_PLUGIN_TOKEN', { exact: true });
    const origin = page.getByText('https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.example.test', { exact: true });
    const capability = page.getByText('photoshop_generate_with_reference_image_and_preserve_all_original_layers', { exact: true });
    for (const element of [address, auth, origin, capability]) {
      expect(await element.evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
    }
    expect(await origin.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(20);
    expect(await capability.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(20);
    const labels = await Promise.all(['公共云端地址', '本地无界默认地址'].map(name => page.getByText(name, { exact: true }).boundingBox()));
    expect(labels[1]!.y).toBeGreaterThan(labels[0]!.y + labels[0]!.height);
  });

  it('keeps every user column readable inside a keyboard accessible local horizontal scroller', async () => {
    const noOp = vi.fn(async () => {});
    const view = render(<div className="dashboard-root"><main className="dashboard-scrollable"><AdminTabs activeTab="users"
      adminUsers={[{ id: 'user-1', name: '用户名示例', email: 'reader@example.test', role: 'user', status: 'active' }]}
      adminGroups={[]} providers={[]} onRefreshAdmin={vi.fn()} onCreateUser={noOp} onRenameUser={noOp}
      onResetPassword={noOp} onToggleUser={noOp} onDeleteUser={vi.fn()} onBatchDeleteUsers={vi.fn(async () => true)}
      onToggleUserPermission={noOp} onRechargeCredits={noOp} /></main></div>);
    await show(view.container, 320);
    await expectContentFits();
    const scroller = page.getByRole('region', { name: '用户列表，可横向滚动' });
    expect(await scroller.getAttribute('tabindex')).toBe('0');
    const scroll = await scroller.evaluate(element => {
      const before = element.scrollLeft;
      element.scrollLeft = element.scrollWidth;
      return { before, after: element.scrollLeft, width: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.width);
    expect(scroll.after).toBeGreaterThan(scroll.before);
    for (const label of ['用户名', '邮箱', '分组', '角色', '状态', '积分余额', '作品数', '注册时间', '最后登录', '操作']) {
      expect(await scroller.getByText(label, { exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(32);
    }
  });
});
