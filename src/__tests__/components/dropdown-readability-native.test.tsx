// @vitest-environment node
// Real shared controls, chat class expressions and shipped CSS; no application server or business I/O.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { literalAttr, openingNodes, parseUiSource, readUiAttr, evaluateUi, variableInitializer } from '../helpers/ui-source-contracts';

const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuCheckboxItem,DropdownMenuShortcut} from '@/components/ui/dropdown-menu';
const root=createRoot(document.getElementById('fixture')!);
const options=<><optgroup label="供应商"><option value="one">可用模型</option><option value="two">另一模型</option><option disabled value="off">停用模型</option></optgroup><optgroup disabled label="停用供应商"><option value="group-off">不可用</option></optgroup></>;
const icon=<svg aria-hidden="true" className="text-muted-foreground size-4" viewBox="0 0 16 16"><path d="M1 8h14" stroke="currentColor"/></svg>;
window.dropdownFixture={selected:0,mount(rows,description){root.render(<>
  <div className="dashboard-root"><select id="native" defaultValue="one">{options}</select><select id="native-disabled" disabled>{options}</select></div>
  <div className="drama-root"><select id="video" defaultValue="one">{options}</select><div className="drama-paper"><select className="drama-input" id="video-paper">{options}</select></div></div>
  <DropdownMenu><DropdownMenuTrigger>菜单</DropdownMenuTrigger><DropdownMenuContent>
    {rows.map((className,index)=><DropdownMenuItem key={index} className={className}>聊天行 {index}{icon}</DropdownMenuItem>)}
    <DropdownMenuItem>普通行<DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut>{icon}</DropdownMenuItem>
    <DropdownMenuCheckboxItem checked>收藏{icon}</DropdownMenuCheckboxItem>
    <DropdownMenuItem disabled onSelect={()=>window.dropdownFixture.selected++}>禁用行</DropdownMenuItem>
    <DropdownMenuItem variant="destructive">删除</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
  <Select defaultValue="one" onValueChange={()=>window.dropdownFixture.selected++}><SelectTrigger aria-label="聊天模型"><SelectValue/></SelectTrigger><SelectContent position="popper">
    <SelectItem value="one">模型一<span data-slot={description.slot} className={description.className}>模型说明</span>{icon}</SelectItem>
    <SelectItem value="off" disabled>禁用模型</SelectItem><SelectItem value="two">模型二</SelectItem>
  </SelectContent></Select>
</>);}};
`;

let browser: Browser;
let css = '', bundle = '', chatSource = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const built = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: ENTRY, loader: 'tsx', resolveDir: process.cwd(), sourcefile: 'dropdown-readability-entry.tsx' } });
  bundle = built.outputFiles[0].text;
  chatSource = await readFile('src/components/chat-panel.tsx', 'utf8');
  const sources = await Promise.all(Object.keys(built.metafile!.inputs).filter(file => file.startsWith('src/') || file.startsWith('src\\'))
    .map(async file => ({ content: await readFile(file, 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY + '\n' + chatSource, extension: 'tsx' });
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: path.resolve('src/app'),
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css'
        ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(path.resolve(base, id));
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    } });
  css = compiler.build(new Scanner({}).scanFiles(sources));
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { await browser?.close(); });

function chatRows(theme: string): { rows: string[]; description: { className: string; slot: unknown } } {
  const source = parseUiSource(chatSource);
  const scope = { isGold: theme === 'gold', isAdded: false, imageModel: 'one', m: { id: 'two' } };
  const nodes = openingNodes(source);
  const rows = nodes.filter(node => node.tagName.getText() === 'DropdownMenuItem'
    && node.attributes.getText().includes('text-gray-700'))
    .map(node => String(readUiAttr(source, node, 'className', scope)));
  expect(rows.length, 'exercise the actual chat row class expressions').toBeGreaterThan(0);
  const modelItem = nodes.find(node => node.tagName.getText() === 'SelectItem');
  if (!modelItem || !ts.isJsxElement(modelItem.parent)) throw Error('CHAT_MODEL_ITEM_MISSING');
  const item = modelItem.parent;
  const description = nodes.find(node => node.getStart() > item.getStart() && node.getEnd() < item.getEnd()
    && node.tagName.getText() === 'span' && node.attributes.getText().includes('themeClasses.textMuted'));
  if (!description) throw Error('CHAT_DESCRIPTION_MISSING');
  const themeClasses = evaluateUi(source, variableInitializer(source, 'themeClasses'), { themeStyle: theme === 'gold' ? 'gold' : 'monochrome' });
  return { rows, description: { className: String(readUiAttr(source, description, 'className', { themeClasses })), slot: literalAttr(description, 'data-slot') } };
}

async function fixture(theme: string, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  const unexpected: string[] = [], errors: string[] = [];
  try {
    await context.route('**/*', route => { unexpected.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.setDefaultTimeout(2500);
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<html class="theme-${theme}"><body><div id="fixture"></div></body></html>`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(({ rows, description }) => {
      (window as unknown as { dropdownFixture: { mount(rows: string[], description: unknown): void } }).dropdownFixture.mount(rows, description);
    }, chatRows(theme));
    await page.locator('#native').waitFor();
    await run(page);
    expect(errors).toEqual([]);
    expect(unexpected, 'isolated rendering must never reach an API or network').toEqual([]);
  } finally { await context.close(); }
}

async function paint(target: Locator): Promise<{ contrast: number; color: string; background: string; scheme: string; opacity: string }> {
  return target.evaluate(element => {
    // Canvas converts browser-resolved rgb/oklch colors into sRGB for WCAG luminance.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const rgba = (value: string): number[] => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const over = (fg: number[], bg: number[]): number[] => fg.slice(0, 3).map((v, i) => v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255)).concat(255);
    const ancestors: Element[] = []; let ancestor: Element | null = element;
    while (ancestor) { ancestors.push(ancestor); ancestor = ancestor.parentElement; }
    let bg = [255, 255, 255, 255];
    for (const node of ancestors.reverse()) bg = over(rgba(getComputedStyle(node).backgroundColor), bg);
    const style = getComputedStyle(element), fg = over(rgba(style.color), bg);
    const luminance = (rgb: number[]): number => rgb.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(fg), b = luminance(bg);
    return { contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: style.color, background: style.backgroundColor, scheme: style.colorScheme, opacity: style.opacity };
  });
}

async function readable(target: Locator): Promise<void> {
  const value = await paint(target);
  expect(value.contrast, JSON.stringify(value)).toBeGreaterThanOrEqual(4.5);
}

describe.each(['gold', 'monochrome'])('dropdown readability in %s', theme => {
  it('keeps every real chat row readable on pointer and keyboard highlight, including icons', async () => {
    // Catches a consumer overriding only focus background or a shared pair losing contrast.
    await fixture(theme, async page => {
      await page.getByRole('button', { name: '菜单', exact: true }).click();
      const menu = page.getByRole('menu');
      const rows = menu.getByRole('menuitem').filter({ hasText: '聊天行' });
      for (const row of await rows.all()) {
        await row.hover(); await readable(row); await readable(row.locator('svg'));
        expect((await paint(row.locator('svg'))).color).toBe((await paint(row)).color);
      }
      await page.keyboard.press('Home');
      await readable(menu.locator('[data-highlighted]'));
      const shortcut = menu.getByText('Ctrl+K');
      await shortcut.locator('..').hover(); await readable(shortcut);
      expect((await paint(shortcut)).color).toBe((await paint(shortcut.locator('..'))).color);
      const checkbox = menu.getByRole('menuitemcheckbox');
      await checkbox.hover(); await readable(checkbox); await readable(checkbox.locator('svg').last());
      const disabled = menu.getByRole('menuitem', { name: '禁用行', exact: true });
      expect(await disabled.getAttribute('data-disabled')).not.toBeNull();
      expect(Number((await paint(disabled)).opacity)).toBeLessThan(1);
      await page.keyboard.press('End'); expect(await disabled.getAttribute('data-highlighted')).toBeNull();
      const destructive = menu.getByRole('menuitem', { name: '删除', exact: true });
      expect((await paint(destructive)).color).not.toBe((await paint(rows.first())).color);
      await page.keyboard.press('Escape');
    });
  }, 15000);

  it('inherits portal palette and makes the real model description and icons readable while skipping disabled choices', async () => {
    // Catches nested muted text retaining its idle color on the highlighted surface.
    await fixture(theme, async page => {
      await page.getByRole('combobox', { name: '聊天模型' }).click();
      const option = page.getByRole('option', { name: /模型一/ });
      await option.hover(); await readable(option); await readable(option.getByText('模型说明')); await readable(option.locator('svg').last());
      expect((await paint(option.getByText('模型说明'))).color).toBe((await paint(option)).color);
      expect((await paint(option.locator('svg').last())).color).toBe((await paint(option)).color);
      expect(await option.evaluate(el => Boolean(el.closest('body') && !el.closest('#fixture')))).toBe(true);
      console.log('DROPDOWN_RENDERED_CONTRAST', theme, JSON.stringify({ row: await paint(option), description: await paint(option.getByText('模型说明')) }));
      await page.keyboard.press('ArrowDown');
      expect(await page.getByRole('option', { name: '禁用模型', exact: true }).getAttribute('data-highlighted')).toBeNull();
      await page.keyboard.press('Enter');
      expect(await page.getByRole('combobox', { name: '聊天模型' }).textContent()).toContain('模型二');
    });
  }, 15000);

  it('pairs native group/selected/disabled colors and respects dark video and light paper scopes', async () => {
    // Catches gold-selector gaps, a dark UA scheme in monochrome, or disabled rows painted as active.
    await fixture(theme, async page => {
      const select = page.locator('#native');
      expect((await paint(select)).scheme).toBe(theme === 'gold' ? 'dark' : 'light');
      await readable(select.locator('optgroup').first());
      await readable(select.locator('option[value=one]')); await readable(select.locator('option[value=two]'));
      const off = select.locator('option[value=off]');
      expect((await paint(off)).color).not.toBe((await paint(select.locator('option[value=two]'))).color);
      expect((await paint(select.locator('option[value=group-off]'))).color).toBe((await paint(off)).color);
      expect(await off.isDisabled()).toBe(true);
      expect(await page.locator('#native-disabled').isDisabled()).toBe(true);
      const video = page.locator('#video');
      expect((await paint(video)).scheme).toBe('dark');
      await readable(video.locator('option[value=one]')); await readable(video.locator('optgroup').first());
      expect((await paint(video.locator('option[value=two]'))).background).not.toBe('rgb(255, 255, 255)');
      expect((await paint(page.locator('#video-paper'))).scheme).toBe('light');
      await readable(page.locator('#video-paper option[value=one]'));
      console.log('NATIVE_OPTION_RENDERED_CONTRAST', theme, JSON.stringify({ selected: await paint(select.locator('option[value=one]')), video: await paint(video.locator('option[value=one]')) }));
    });
  }, 15000);
});
