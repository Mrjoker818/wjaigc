import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator } from '@playwright/test';
import { Scanner } from '@tailwindcss/oxide';
import { compile } from 'tailwindcss';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';

const origin = 'https://ui-holds.fixture.invalid';
const entry = `
import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrandAssetManager} from '@/components/brand-ecommerce/BrandAssetManager';
import BrandIpPanel from '@/components/brand-ip-panel';
import OhMyPrompt from '@/components/oh-my-prompt';
import {PromptEquation} from '@/components/prompt-equation';
import {VenueRegionCanvas} from '@/components/venue-region-canvas';
const settings={productDesc:'', styleExtra:'', sceneDesc:'', brandColors:[], refImage:'', productImage:'', selectedModel:'', mainText:'', secondaryText:'', accentSymbol:''};
function Fixture(){
  const [outcome,setOutcome]=useState('');
  const [selected,setSelected]=useState(null);
  const result=h('output',{'data-testid':'fixture-result'},outcome);
  switch(location.pathname){
    case '/brand': return h('main',{style:{margin:24}},h(BrandAssetManager,{userId:'fixture-user',currentSettings:settings,
      onApply:asset=>setOutcome(asset.id+' '+asset.mainText)}),result);
    case '/brand-ip': return h(BrandIpPanel,{onClose:()=>{}});
    case '/vision': return h(OhMyPrompt,{isOpen:true,defaultActiveTab:'vision',floating:true,onClose:()=>{},onInsertPrompt:setOutcome});
    case '/equation': return h(PromptEquation,{open:true,onClose:()=>{},onSendToPrompt:setOutcome});
    case '/venue': return h('div',{style:{width:320}},h(VenueRegionCanvas,{imageUrl:'/portrait.svg',regions:[
      {id:'entrance',name:'入口',type:'entrance',position:{x:0,y:0,w:1,h:1}},
      {id:'display',name:'展区',type:'main-display',position:{x:.3,y:.3,w:.4,h:.4}}],
      selectedRegionId:selected,onSelectRegion:id=>{setSelected(id);setOutcome(id);}}),result);
  }
}
createRoot(document.getElementById('fixture')).render(h(Fixture));
`;

const sources = ['src/components/brand-ecommerce/BrandAssetManager.tsx', 'src/components/brand-ip-panel.tsx',
  'src/components/oh-my-prompt.tsx', 'src/components/prompt-equation.tsx', 'src/components/venue-region-canvas.tsx',
  'src/components/ui/popover.tsx', 'src/components/ui/button.tsx'];
let browser: Browser, bundle: string, css: string;

beforeAll(async () => {
  const id = 'virtual:ui-hold-fixture';
  const result = await build({ configFile: false, envFile: false, publicDir: false, logLevel: 'error',
    resolve: { alias: { '@': path.resolve('src') } }, esbuild: { jsx: 'automatic', jsxDev: false },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, minify: false, lib: { entry: id, name: 'UIHoldFixture', formats: ['iife'] }, rollupOptions: { input: id } },
    plugins: [{ name: 'ui-hold-fixture', resolveId: candidate => candidate === id ? '\0' + id : null,
      load: candidate => candidate === '\0' + id ? entry : null }],
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output) || output.output[0].type !== 'chunk') throw Error('Expected a browser fixture bundle');
  bundle = output.output[0].code;
  const require = createRequire(import.meta.url);
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: process.cwd(),
    loadStylesheet: async (name, base) => {
      const file = name === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : name === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : path.resolve(base, name);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  css = compiler.build(new Scanner({}).scanFiles(await Promise.all(sources.map(async file => ({ content: await readFile(file, 'utf8'), extension: 'tsx' })))));
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

async function offline(context: BrowserContext) {
  const writes: string[] = [];
  let isDefault = false;
  const project = { id: 'fixture', name: '合成品牌项目', currentStage: 'brand-goal', brief: { brandName: '合成品牌' },
    directions: [], immutableCore: [], controlledVariables: [] };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: bundle });
    if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: css });
    if (url.pathname === '/portrait.svg') return route.fulfill({ contentType: 'image/svg+xml', body:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400"><rect width="100" height="400" fill="#d4af37"/></svg>' });
    if (url.pathname === '/api/brand-assets') {
      if (request.method() === 'GET') return route.fulfill({ json: { success: true, assets: [{ id: 'synthetic-scheme', name: '合成方案', main_text: '合成主标题', is_default: isDefault }] } });
      const action = request.postDataJSON().action as string;
      writes.push(action);
      if (action === 'setDefault') { isDefault = true; return route.fulfill({ json: { success: true } }); }
      return route.abort();
    }
    if (request.method() !== 'GET') return route.abort();
    if (url.pathname === '/api/brand-ip/projects') return route.fulfill({ json: url.searchParams.has('projectId') ? { project } : { projects: [project] } });
    if (url.pathname === '/api/brand-ip/assets') return route.fulfill({ json: { assets: [] } });
    if (url.pathname === '/api/brand-ip/tasks') return route.fulfill({ json: { tasks: [] } });
    if (url.pathname === '/api/models') return route.fulfill({ json: { models: [], providers: [] } });
    if (['/brand', '/brand-ip', '/vision', '/equation', '/venue'].includes(url.pathname)) return route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="fixture"></div><script src="/fixture.js"></script>' });
    return route.abort();
  });
  return writes;
}

function touchContext() {
  return browser.newContext({ serviceWorkers: 'block', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
}

async function fixturePage(context: BrowserContext, surface: string) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + surface);
  try { await page.locator('#fixture > *').first().waitFor(); }
  catch (error) { throw new Error(`Fixture failed to render ${surface} ${errors.join(', ')}`, { cause: error }); }
  return page;
}

async function tap(target: Locator) {
  await target.waitFor();
  const rect = await target.boundingBox();
  expect(rect?.width).toBeGreaterThanOrEqual(44);
  expect(rect?.height).toBeGreaterThanOrEqual(44);
  await target.tap();
}

it('tabs to the saved brand scheme and applies it with native keyboard activation', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const writes = await offline(context), page = await fixturePage(context, '/brand');
    const trigger = page.getByRole('button', { name: /品牌方案/ });
    await trigger.focus(); await page.keyboard.press('Enter');
    const apply = page.getByRole('button', { name: /应用方案.*合成方案/ });
    await apply.waitFor({ timeout: 2000 });
    for (let index = 0; index < 5 && !await apply.evaluate(el => el === document.activeElement); index++) await page.keyboard.press('Tab');
    expect(await apply.evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Space');
    await page.getByText('synthetic-scheme 合成主标题', { exact: true }).waitFor();
    await page.getByRole('dialog', { name: '已保存的品牌方案' }).waitFor({ state: 'hidden' });
    expect(await trigger.evaluate(el => el === document.activeElement)).toBe(true);
    expect(writes).toEqual([]);
  } finally { await context.close(); }
}, 20_000);

it('keeps apply and set-default as separate touch targets', async () => {
  const context = await touchContext();
  try {
    const writes = await offline(context), page = await fixturePage(context, '/brand');
    await page.getByRole('button', { name: /品牌方案/ }).tap();
    await tap(page.getByTitle('设为默认', { exact: true }));
    await page.getByTitle('默认方案', { exact: true }).waitFor();
    expect(await page.getByTestId('fixture-result').textContent()).toBe('');
    await tap(page.getByRole('button', { name: /应用方案.*合成方案/ }));
    await page.getByText('synthetic-scheme 合成主标题', { exact: true }).waitFor();
    expect(writes).toEqual(['setDefault']);
  } finally { await context.close(); }
}, 20_000);

it('opens the vision file chooser from the keyboard and from touch', async () => {
  const context = await touchContext();
  try {
    await offline(context);
    const page = await fixturePage(context, '/vision');
    const upload = page.getByRole('button', { name: '上传图片' });
    await upload.waitFor({ timeout: 2000 });
    await upload.focus();
    const [first] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    await first.setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4st78PwgzwBgAYgQK5f/y4U4AAAAASUVORK5CYII=', 'base64') });
    const replace = page.getByRole('button', { name: '更换图片' });
    await replace.waitFor();
    const [second] = await Promise.all([page.waitForEvent('filechooser'), tap(replace)]);
    await second.setFiles([]);
    await tap(page.getByRole('button', { name: '移除图片' }));
    await upload.waitFor();
  } finally { await context.close(); }
}, 20_000);

it('opens the Brand IP project using its touch-sized choice', async () => {
  const context = await touchContext();
  try {
    await offline(context);
    const page = await fixturePage(context, '/brand-ip');
    await tap(page.getByRole('button', { name: '品牌IP项目列表' }));
    await tap(page.getByRole('button', { name: '合成品牌项目' }));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some(input => input.value === '合成品牌'));
  } finally { await context.close(); }
}, 20_000);

it('keeps formula collapse keyboard-accessible and reset reachable by touch', async () => {
  const context = await touchContext();
  try {
    await offline(context);
    const page = await fixturePage(context, '/equation');
    const subject = page.getByRole('button', { name: '主体', exact: true });
    await subject.focus(); await page.keyboard.press('Space');
    expect(await subject.getAttribute('aria-expanded')).toBe('false');
    await tap(subject);
    const input = page.getByRole('textbox', { name: '主体', exact: true });
    await input.fill('合成公式');
    await tap(page.getByRole('button', { name: '重置', exact: true }));
    expect(await input.inputValue()).toBe('');
  } finally { await context.close(); }
}, 20_000);

it('maps touch to the portrait content and ignores the letterbox', async () => {
  const context = await touchContext();
  try {
    await offline(context);
    const page = await fixturePage(context, '/venue');
    const canvas = page.locator('canvas');
    await page.waitForFunction(() => document.querySelector('canvas')?.height === 1280);
    const rect = (await canvas.boundingBox())!;
    expect(rect.width).toBe(320); expect(rect.height).toBe(360);
    await page.touchscreen.tap(rect.x + 12, rect.y + rect.height / 2);
    expect(await page.getByTestId('fixture-result').textContent()).toBe('');
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.getByText('display', { exact: true }).waitFor();
  } finally { await context.close(); }
}, 20_000);
