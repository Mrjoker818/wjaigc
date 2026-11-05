// @vitest-environment node
// Real VectorEditorDialog and project styles; no application server or network access.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://vector-editor-test.invalid';
const NORMAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160" width="200" height="160"><rect x="10" y="10" width="80" height="140" fill="#ff0000"/><rect x="110" y="10" width="80" height="140" fill="#0000ff"/></svg>';
const TALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 800" width="200" height="800"><rect x="0" y="0" width="200" height="380" fill="#ff0000"/><rect x="0" y="420" width="200" height="380" fill="#0000ff"/></svg>';
const SQUARE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="220" height="220"><rect x="200" y="0" width="20" height="40" fill="#ff0000"/><rect x="20" y="120" width="80" height="80" fill="#0000ff"/></svg>';
const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { VectorEditorDialog } from '@/components/vector-design/vector-editor-dialog';
const root = createRoot(document.getElementById('fixture-root')!);
const state = { closed: 0, saved: 0, savedSvg: '' };
Object.assign(window, { vectorFixture: {
  state,
  mount(svg: string) {
    root.render(<><Toaster /><VectorEditorDialog asset={{ svg, svgUrl: '', previewUrl: '', width: 200, height: 160,
      pathCount: 2, model: 'synthetic', providerId: 'synthetic', providerName: 'synthetic', sourceType: 'synthetic' }}
      templateIds={[]} onClose={() => { state.closed++; const fixture = window as Window & {releaseOnClose?: boolean; deferredBlob?: BlobCallback | null}; if (fixture.releaseOnClose) { fixture.deferredBlob?.(null); fixture.deferredBlob = null; } root.render(<Toaster />); }} onSave={(value) => { state.saved++; state.savedSvg = value.svg; }} /></>);
  },
  unmount() { root.unmount(); },
} });
`;

interface FixtureWindow extends Window {
  vectorFixture: { state: { closed: number; saved: number; savedSvg: string }; mount(svg: string): void; unmount(): void };
  deferredBlob?: BlobCallback | null;
  releaseOnClose?: boolean;
  urlAudit?: { created: string[]; revoked: string[] };
}
interface Rect { x: number; y: number; width: number; height: number; right: number; bottom: number }
interface Metrics { rect: Rect; modal: Rect; hit: boolean; hitLabel: string | null }
interface Scenario { width: number; height: number; touch: boolean }

let browser: Browser | undefined;
let bundle = '';
let css = '';

beforeAll(async () => {
  const require = createRequire(path.resolve("package.json"));
  const component = await readFile(path.resolve('src/components/vector-design/vector-editor-dialog.tsx'), 'utf8');
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
  const result = await build({ write: false, bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'vector-editor-mobile-entry.tsx' } });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => { try { await browser?.close(); } finally { browser = undefined; } }, 15000);

async function metrics(locator: Locator): Promise<Metrics> {
  return locator.evaluate(element => {
    const box = (target: Element): Rect => {
      const r = target.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const rect = box(element);
    const modal = box(element.closest('[data-modal]')!.firstElementChild!);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { rect, modal, hit: hit !== null && (hit === element || element.contains(hit)),
      hitLabel: hit?.closest('button')?.getAttribute('aria-label') ?? hit?.tagName ?? null };
  });
}

function expectReachable(value: Metrics, scenario: Scenario, minSize = 0): void {
  const { rect, modal, hit } = value;
  expect(rect.width).toBeGreaterThanOrEqual(minSize);
  expect(rect.height).toBeGreaterThanOrEqual(minSize);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeGreaterThanOrEqual(Math.max(0, modal.x));
  expect(rect.y).toBeGreaterThanOrEqual(Math.max(0, modal.y));
  expect(rect.right).toBeLessThanOrEqual(Math.min(scenario.width, modal.right));
  expect(rect.bottom).toBeLessThanOrEqual(Math.min(scenario.height, modal.bottom));
  expect(hit, JSON.stringify(value)).toBe(true);
}

function expectInside(inner: Rect, outer: Rect): void {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.right).toBeLessThanOrEqual(outer.right);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom);
}

async function activate(locator: Locator, scenario: Scenario): Promise<void> {
  if (scenario.touch) await locator.tap({ timeout: 3000 });
  else await locator.click({ timeout: 3000 });
}

async function withEditor(scenario: Scenario, svg: string, run: (page: Page) => Promise<void>, expected = { saved: 1, downloads: 3, requests: ['GET /', 'POST /api/vector-design'] }): Promise<void> {
  if (!browser) throw Error('VECTOR_EDITOR_BROWSER_MISSING');
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
    hasTouch: scenario.touch, isMobile: scenario.touch, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const requests: string[] = [], errors: string[] = [];
  let downloadCount = 0;
  let mounted = false, contextClosed = false;
  context.once('close', () => { contextClosed = true; });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push('PAGE ' + error.message));
  page.on('download', () => { downloadCount++; });

  await context.routeWebSocket('**/*', socket => { errors.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), headers = await request.allHeaders();
    const key = request.method() + ' ' + url.pathname + url.search;
    requests.push(key);
    try {
      if (url.origin !== ORIGIN || headers.cookie || headers.authorization || headers['x-api-key']) throw Error('OUTSIDE_BOUNDARY ' + key);
      if (key === 'POST /api/vector-design') {
        const body = request.postDataJSON();
        if (body.action !== 'edit' || body.providerId !== 'synthetic' || body.model !== 'synthetic' || typeof body.sourceSvg !== 'string') throw Error('BAD_SYNTHETIC_SAVE');
        await route.fulfill({json:{success:true,asset:{svg:body.sourceSvg,svgUrl:'',previewUrl:'',width:200,height:160,pathCount:2,model:'synthetic',providerId:'synthetic',providerName:'synthetic',sourceType:'synthetic'}}});return;
      }
      if (key !== 'GET /') throw Error('UNEXPECTED_REQUEST ' + key);
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` });
    } catch (error) { errors.push(String(error)); await route.abort(); }
  });
  try {
    await page.goto(ORIGIN + '/');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(value => (window as unknown as FixtureWindow).vectorFixture.mount(value), svg);
    mounted = true;
    await page.locator('.vector-edit-stage rect').first().waitFor({ state: 'attached' });
    await run(page);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.state.saved)).toBe(expected.saved);
    expect(downloadCount).toBe(expected.downloads);
  } finally {
    try { if (mounted) await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.unmount()); }
    finally { await context.close(); }
    expect(contextClosed).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual(expected.requests);
  }
}

async function recolorAndUndo(page: Page, scenario: Scenario): Promise<void> {
  const stage = page.locator('.vector-edit-stage');
  const first = stage.locator('rect').first();
  expectReachable(await metrics(first), scenario, 44);
  await activate(first, scenario);
  expect(await page.getByText('元素 1', { exact: true }).isVisible()).toBe(true);
  const color = page.getByRole('button', { name: '应用颜色', exact: true });
  await color.scrollIntoViewIfNeeded();
  expectReachable(await metrics(color), scenario, scenario.touch ? 44 : 0);
  const picker = page.locator('input[type="color"]');
  expectReachable(await metrics(picker), scenario, scenario.touch ? 44 : 0);
  await activate(color, scenario);
  expect(await stage.locator('rect').nth(0).getAttribute('fill')).toBe('#d4af37');
  expect(await stage.locator('rect').nth(1).getAttribute('fill')).toBe('#0000ff');
  const undo = page.getByRole('button', { name: '撤销上一步', exact: true });
  await undo.scrollIntoViewIfNeeded();
  expectReachable(await metrics(undo), scenario, scenario.touch ? 44 : 0);
  await activate(undo, scenario);
  expect(await stage.locator('rect').nth(0).getAttribute('fill')).toBe('#ff0000');
  expect(await stage.locator('rect').nth(1).getAttribute('fill')).toBe('#0000ff');
}

async function expectSaveAndDownloadEntrances(page: Page, scenario: Scenario): Promise<void> {
  for (const name of ['保存到画布', '下载 SVG', '下载 PNG', '下载 JPG']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    expect(await button.isEnabled()).toBe(true);
    expectReachable(await metrics(button), scenario);
  }
}

for(const scenario of [{width:320,height:640,touch:true},{width:640,height:320,touch:true}] as const) it(`mobile ${scenario.width}x${scenario.height} edited SVG PNG JPG downloads and save`, async()=>{
 await withEditor(scenario,NORMAL_SVG,async page=>{
   await page.evaluate(() => { const audit = { created: [] as string[], revoked: [] as string[] }; (window as unknown as FixtureWindow).urlAudit = audit; const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL); URL.createObjectURL = blob => { const value = create(blob); audit.created.push(value); return value; }; URL.revokeObjectURL = value => { audit.revoked.push(value); revoke(value); }; });
   const stage=page.locator('.vector-edit-stage');const rect=stage.locator('rect').first();
   await activate(rect,scenario);
   const color=page.getByRole('button',{name:'应用颜色',exact:true});await color.scrollIntoViewIfNeeded();await activate(color,scenario);
   expect(await stage.locator('rect').nth(0).getAttribute('fill')).toBe('#d4af37');
   expect(await stage.locator('rect').nth(1).getAttribute('fill')).toBe('#0000ff');
   const binary:Record<string,Buffer>={};
   for(const spec of [{name:'下载 SVG',file:'wujie-vector.svg',kind:'svg'},{name:'下载 PNG',file:'wujie-vector.png',kind:'png'},{name:'下载 JPG',file:'wujie-vector.jpg',kind:'jpg'}]){
     const button=page.getByRole('button',{name:spec.name,exact:true});await button.scrollIntoViewIfNeeded();
     const [download]=await Promise.all([page.waitForEvent('download',{timeout:5000}),activate(button,scenario)]);
     expect(download.suggestedFilename()).toBe(spec.file);const file=await download.path();if(!file)throw Error('DOWNLOAD_PATH_MISSING');
     binary[spec.kind]=await readFile(file);expect(binary[spec.kind].length).toBeGreaterThan(20);
   }
   const text=binary.svg.toString('utf8');expect(text).toContain('#d4af37');expect(text).toContain('#0000ff');

   for(const kind of ['png','jpg'] as const){
     const data=await sharp(binary[kind]).metadata();expect(data.format).toBe(kind==='jpg'?'jpeg':'png');expect(data.width).toBe(200);expect(data.height).toBe(160);
     const pixels=await sharp(binary[kind]).ensureAlpha().raw().toBuffer();const sample=(x:number,y:number)=>Array.from(pixels.subarray((y*200+x)*4,(y*200+x)*4+4));
     const background=sample(0,0),gold=sample(30,40),blue=sample(130,40);
     if(kind==='png'){expect(background[3]).toBe(0);expect(gold).toEqual([212,175,55,255]);expect(blue).toEqual([0,0,255,255]);}
     else {expect(background[3]).toBe(255);for(const c of background.slice(0,3))expect(c).toBeGreaterThan(240);for(const [actual,target] of gold.slice(0,3).map((value,index)=>[value,[212,175,55][index]]))expect(Math.abs(actual-target)).toBeLessThan(20);expect(blue[2]).toBeGreaterThan(230);}
   }
   await expect.poll(async () => page.evaluate(() => { const audit = (window as unknown as FixtureWindow).urlAudit!; return { created: audit.created.length, revoked: audit.revoked.length, missing: audit.created.filter(value => !audit.revoked.includes(value)).length }; }), { timeout: 4000 }).toEqual({ created: 5, revoked: 5, missing: 0 });
   const save=page.getByRole('button',{name:'保存到画布',exact:true});await save.scrollIntoViewIfNeeded();await activate(save,scenario);
   await expect.poll(async()=>page.evaluate(()=>(window as unknown as FixtureWindow).vectorFixture.state.saved),{timeout:3000}).toBe(1);
   const state=await page.evaluate(()=>(window as unknown as FixtureWindow).vectorFixture.state);expect(state.closed).toBe(1);expect(state.savedSvg).toContain('#d4af37');expect(state.savedSvg).toContain('#0000ff');
 });
},25000);
for (const format of ['PNG', 'JPG'] as const) it(`mobile ${format} export failure is reported without closing`, async () => {
  const scenario = { width: 320, height: 640, touch: true };
  await withEditor(scenario, NORMAL_SVG, async page => {
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); }; });
    const button = page.getByRole('button', { name: `下载 ${format}`, exact: true });
    await button.scrollIntoViewIfNeeded();
    await activate(button, scenario);
    await page.getByText('导出失败', { exact: true }).waitFor({ state: 'visible', timeout: 2000 });
    expect(await page.locator('[data-modal]').isVisible()).toBe(true);
  }, { saved: 0, downloads: 0, requests: ['GET /'] });
}, 25000);

it('late export failure after closing does not show a stale error', async () => {
  const scenario = { width: 320, height: 640, touch: true };
  await withEditor(scenario, NORMAL_SVG, async page => {
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback) { (window as unknown as FixtureWindow).deferredBlob = callback; }; });
    const button = page.getByRole('button', { name: '下载 PNG', exact: true });
    await button.scrollIntoViewIfNeeded(); await activate(button, scenario);
    await page.waitForFunction(() => typeof (window as unknown as FixtureWindow).deferredBlob === 'function');
    const close = page.locator('button[aria-label="关闭"]:visible');
    await close.scrollIntoViewIfNeeded(); await activate(close, scenario);
    expect(await page.locator('[data-modal]').count()).toBe(0);
    await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.deferredBlob?.(null); fixture.deferredBlob = null; });
    await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await page.getByText('导出失败', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).vectorFixture.state.closed)).toBe(1);
  }, { saved: 0, downloads: 0, requests: ['GET /'] });
}, 25000);
it('failure released during close does not show a stale error', async () => {
  const scenario = { width: 320, height: 640, touch: true };
  await withEditor(scenario, NORMAL_SVG, async page => {
    await page.evaluate(() => { (window as unknown as FixtureWindow).releaseOnClose = true; HTMLCanvasElement.prototype.toBlob = function (callback) { (window as unknown as FixtureWindow).deferredBlob = callback; }; });
    const button = page.getByRole('button', { name: '下载 PNG', exact: true });
    await button.scrollIntoViewIfNeeded(); await activate(button, scenario);
    await page.waitForFunction(() => typeof (window as unknown as FixtureWindow).deferredBlob === 'function');
    const close = page.locator('button[aria-label="关闭"]:visible');
    await close.scrollIntoViewIfNeeded(); await activate(close, scenario);
    expect(await page.locator('[data-modal]').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).deferredBlob)).toBeNull();
    await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await page.getByText('导出失败', { exact: true }).count()).toBe(0);
  }, { saved: 0, downloads: 0, requests: ['GET /'] });
}, 25000);

it('failure from the old editor does not affect a newly opened editor', async () => {
  const scenario = { width: 320, height: 640, touch: true };
  await withEditor(scenario, NORMAL_SVG, async page => {
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback) { (window as unknown as FixtureWindow).deferredBlob = callback; }; });
    const button = page.getByRole('button', { name: '下载 PNG', exact: true });
    await button.scrollIntoViewIfNeeded(); await activate(button, scenario);
    await page.waitForFunction(() => typeof (window as unknown as FixtureWindow).deferredBlob === 'function');
    const close = page.locator('button[aria-label="关闭"]:visible');
    await close.scrollIntoViewIfNeeded(); await activate(close, scenario);
    expect(await page.locator('[data-modal]').count()).toBe(0);
    await page.evaluate(value => (window as unknown as FixtureWindow).vectorFixture.mount(value), NORMAL_SVG);
    await page.locator('.vector-edit-stage rect').first().waitFor({ state: 'attached' });
    await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.deferredBlob?.(null); fixture.deferredBlob = null; });
    await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await page.getByText('导出失败', { exact: true }).count()).toBe(0);
    expect(await page.locator('[data-modal]').isVisible()).toBe(true);
  }, { saved: 0, downloads: 0, requests: ['GET /'] });
}, 25000);