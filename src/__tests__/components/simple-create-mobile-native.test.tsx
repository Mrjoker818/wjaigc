// @vitest-environment node
// Real SimpleCreatePage and styles, synthetic in-memory dependencies, no provider or business network.
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ENTRY = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleCreatePage } from '@/components/simple-create/simple-create-page';
const state={submissions:[],cancelled:[],retried:[],navigated:[],downloaded:[],disposed:false};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const slots=[{id:'fake-active',projectId:'fake-project',taskId:'fake-task',status:'processing',progress:25},
 {id:'fake-failed',projectId:'fake-project',taskId:'fake-task2',status:'failed',progress:0,error:{message:'测试失败-'+('X'.repeat(120)),retryable:true}},
 {id:'fake-done',projectId:'fake-project',taskId:'fake-task3',status:'completed',progress:100,url:image,assetVersionId:'fake-version',placementId:'fake-placement'}];
const session={subscribe:()=>()=>{},snapshot:()=>slots,restore:async()=>slots,submit:async value=>{state.submissions.push(value);return[];},cancel:async id=>{state.cancelled.push(id);return true;},retry:async id=>{state.retried.push(id);return null;},dispose:()=>{}};
const dependencies={getSession:async()=>({authenticated:true}),loadModels:async()=>[{providerId:'fake-provider',providerName:'合成供应商',modelId:'fake-image',modelName:'合成图像模型',allowedRatios:['1:1','16:9'],allowedSizes:['1024x1024','1536x1024'],qualityOptions:['standard','high'],maxOutputs:4,supportsReferenceImages:true,maxReferenceImages:2},{providerId:'fake-provider-b',providerName:'合成第二供应商',modelId:'fake-image',modelName:'合成图像模型',allowedRatios:['1:1','16:9'],allowedSizes:['1024x1024','1536x1024'],qualityOptions:['standard','high'],maxOutputs:4,supportsReferenceImages:true,maxReferenceImages:2}],uploadReference:async()=>({url:image,assetVersionId:'fake-ref'}),session,navigate:url=>state.navigated.push(url),download:(url,name)=>state.downloaded.push({url,name})};
const root=createRoot(document.getElementById('root'));
Object.assign(window,{simpleCreateFixture:{state,mount(projectId="fake-project"){root.render(<SimpleCreatePage initialProjectId={projectId} dependencies={dependencies}/>);},unmount(){root.unmount();state.disposed=true;}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const variants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
  const browserFiles = new Map(variants.browserVariantModules.map(id => [require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`)]));
  const framework = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
  const result = await build({ write: false, outfile: 'simple-create-fixture.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' }, inject: ['simple-create-fixture-process'],
    plugins: [{ name: 'browser-fixture', setup(builder): void {
      builder.onResolve({ filter: new NativeRegExp('^simple-create-fixture-process$') }, () => ({ path: 'process', namespace: 'fixture' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'fixture' }, () => ({ contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd() }));
      const allowed = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && allowed.has(path.resolve(args.importer)) ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(framework.source, framework.flags) }, args => { if (!args.importer) return undefined; const file = browserFiles.get(createRequire(args.importer).resolve(args.path)); return file ? { path: file } : undefined; });
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-create-mobile-entry.tsx' } });
  bundle = result.outputFiles.filter(file => file.path.endsWith('.js'))[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: process.cwd(), loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.join(process.cwd(), 'node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } });
  css = compiler.build(new Scanner({}).scanFiles(sources)) + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function visibleTarget(page: Page, target: Locator): Promise<void> {
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const rect = await target.boundingBox(); if (!rect) throw Error('SIMPLE_CREATE_TARGET_MISSING');
  const viewport = page.viewportSize()!;
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(await target.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
}

describe('simple create mobile layout and operations', () => {
  it.each([[320, 640], [640, 320]])('%i x %i keeps a long project identifier readable', async (width, height) => {
    const context = await browser!.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.routeWebSocket('**/*', socket => { errors.push('unexpected websocket'); socket.close(); });
    await context.route('**/*', async route => { if (route.request().isNavigationRequest() && route.request().url() === 'https://simple-create-fixture.invalid/') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div>' }); else { errors.push('unexpected network'); await route.abort('blockedbyclient'); } });
    try {
      await page.goto('https://simple-create-fixture.invalid/'); await page.addScriptTag({ content: bundle });
      const projectId = 'project-' + 'x'.repeat(120);
      await page.evaluate(id => (window as unknown as { simpleCreateFixture: { mount(id: string): void } }).simpleCreateFixture.mount(id), projectId);
      const title = page.getByText(`项目 ${projectId}`, { exact: true }); await title.waitFor();
      const dimensions = await title.evaluate(element => { const r=element.getBoundingClientRect(); return { x:r.x, right:r.right, width:element.clientWidth, scrollWidth:element.scrollWidth }; });
      expect(dimensions.x).toBeGreaterThanOrEqual(0); expect(dimensions.right).toBeLessThanOrEqual(width + 0.5);
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
      const captureDir = path.resolve('output/playwright/simple-create-mobile-20261029'); await mkdir(captureDir, { recursive: true });
      await page.screenshot({ path: path.join(captureDir, `${width}x${height}-long-project.png`) });
      expect(errors).toEqual([]); await page.evaluate(() => (window as unknown as { simpleCreateFixture: { unmount(): void } }).simpleCreateFixture.unmount());
    } finally { await context.close(); }
  }, 25000);
  it.each([[320, 640], [375, 812], [390, 844], [640, 320]])('%i x %i supports form and result controls with synthetic tasks', async (width, height) => {
    const context = await browser!.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage(), errors: string[] = [], requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.routeWebSocket('**/*', socket => { errors.push('unexpected websocket'); socket.close(); });
    await context.route('**/*', async route => { const request = route.request(); requests.push(request.method() + ' ' + request.url());
      if (request.isNavigationRequest() && request.url() === 'https://simple-create-fixture.invalid/') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div>' });
      else { errors.push('unexpected network'); await route.abort('blockedbyclient'); }
    });
    try {
      await page.goto('https://simple-create-fixture.invalid/'); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as { simpleCreateFixture: { mount(): void } }).simpleCreateFixture.mount());
      const model = page.getByLabel('模型', { exact: true }); await model.waitFor();
      const captureDir = path.resolve('output/playwright/simple-create-mobile-20261029'); await mkdir(captureDir, { recursive: true });
      await page.screenshot({ path: path.join(captureDir, `${width}x${height}-form.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const label of ['模型', '提示词', '画面比例', '图片尺寸', '图片质量', '生成数量']) await visibleTarget(page, page.getByLabel(label, { exact: true }));
      await model.selectOption('fake-provider-b::fake-image');
      await page.getByLabel('提示词', { exact: true }).fill('合成测试，无真实生成');
      await page.getByLabel('画面比例', { exact: true }).selectOption('16:9');
      await page.getByLabel('生成数量', { exact: true }).selectOption('2');
      await page.getByLabel('参考图', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic') });
      const removeReference = page.getByRole('button', { name: '移除参考图 1', exact: true }); await removeReference.waitFor(); await visibleTarget(page, removeReference); await removeReference.tap();
      expect(await page.getByRole('button', { name: '移除参考图 1', exact: true }).count()).toBe(0);
      const submit = page.getByRole('button', { name: '开始生成' }); await visibleTarget(page, submit); await submit.tap();
      const state = () => page.evaluate(() => (window as unknown as { simpleCreateFixture: { state: { submissions: Array<Record<string, unknown>>; cancelled: string[]; retried: string[]; navigated: string[]; downloaded: unknown[]; disposed: boolean } } }).simpleCreateFixture.state);
      await expect.poll(async () => (await state()).submissions.length).toBe(1);
      expect((await state()).submissions[0]).toMatchObject({ projectId: 'fake-project', providerId: 'fake-provider-b', model: 'fake-image', aspectRatio: '16:9', outputCount: 2 });
      for (const label of ['取消 fake-active', '重试 fake-failed', '下载 fake-done', '在画布中打开 fake-done']) await visibleTarget(page, page.getByRole('button', { name: label, exact: true }));
      const failure = page.getByText('测试失败-' + 'X'.repeat(120), { exact: true }); await failure.scrollIntoViewIfNeeded();
      expect(await failure.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'long provider error remains readable rather than horizontally clipped').toBe(true);
      await page.screenshot({ path: path.join(captureDir, `${width}x${height}-long-error.png`) });
      await page.getByRole('button', { name: '取消 fake-active' }).tap(); await page.getByRole('button', { name: '重试 fake-failed' }).tap();
      expect((await state()).cancelled).toEqual(['fake-active']); expect((await state()).retried).toEqual(['fake-failed']);
      await page.getByRole('button', { name: '下载 fake-done' }).tap(); await page.getByRole('button', { name: '在画布中打开 fake-done' }).tap();
      expect((await state()).downloaded).toEqual([expect.objectContaining({ name: 'fake-done.png' })]);
      expect((await state()).navigated).toEqual(['/?projectId=fake-project&assetVersionId=fake-version&placementId=fake-placement']);
      await page.screenshot({ path: path.join(captureDir, `${width}x${height}-results.png`) });
      await page.evaluate(() => (window as unknown as { simpleCreateFixture: { unmount(): void } }).simpleCreateFixture.unmount());
      expect((await state()).disposed).toBe(true); expect(errors).toEqual([]); expect(requests).toEqual(['GET https://simple-create-fixture.invalid/']);
    } finally { await context.close(); }
  }, 25000);
});
