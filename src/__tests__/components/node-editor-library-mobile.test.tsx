// @vitest-environment node
// Real NodeEditor and shipped styles in Chromium. Synthetic HTTP only, never
// a saved browser profile, business account, real model or cloned UI.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Workflow } from '@/lib/workflow-engine';

type Theme = 'gold' | 'mono';
type Directory = 'material' | 'prompts' | 'presets';
interface Options { asset?: 'allow' | 'deny' | 'scope'; initial?: boolean; touch?: boolean }
interface FixtureWindow extends Window { nodeLibrary: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null }
const ORIGIN = 'https://node-library-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const TITLES: Record<Directory, string> = { material: '素材库', prompts: '提示词库', presets: '预设工作流' };
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import NodeEditor from '@/components/node-editor';
import {createEmptyWorkflow,createWorkflowNode,type Workflow} from '@/lib/workflow-engine';
const root=createRoot(document.getElementById('fixture-root')!);
const state={workflow:null as Workflow|null,disposed:false};let mounted=false;
Object.assign(window,{nodeLibrary:{state,mount(theme:'gold'|'mono',options:{asset?:string;initial?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_LIBRARY_FIXTURE_REMOUNT');mounted=true;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)throw Error('NODE_LIBRARY_FIXTURE_CANVAS');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,48,48);const url=canvas.toDataURL();
 const workflow={...createEmptyWorkflow('离线目录验收工作流'),id:'ui-node-workflow'};
 if(options.initial)workflow.nodes=[createWorkflowNode('input-text',40,60,'保留的原节点')];
 const images=[{id:'ui-source-image',url,name:'离线规范素材',description:'离线规范素材',width:48,height:48,assetId:'ui-source-asset',assetVersionId:'ui-source-version',placementId:'ui-source-placement',projectId:options.asset==='scope'?'ui-other-project':'ui-node-project'}];
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
 root.render(<NodeEditor workflow={workflow} userId="ui-node-actor" projectId="ui-node-project" canvasDocumentMode themeStyle={theme==='mono'?'monochrome':'gold'} canvasImages={images}
 onWorkflowChange={value=>{state.workflow=value;}} onBack={()=>{throw Error('NODE_LIBRARY_FIXTURE_UNEXPECTED_NAVIGATION')}}/>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('NODE_LIBRARY_FIXTURE_NATIVE_LOADER');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const result = await build({ write: false, outfile: 'node-library-fixture.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' }, inject: ['task5-next-client-process'],
    plugins: [{ name: 'next-official-browser-variants', setup(builder: import('esbuild').PluginBuild): void {
      const browserVariants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
      const variants = new Map(browserVariants.browserVariantModules.map(id => [require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`)]));
      const frameworkFilter = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
      builder.onResolve({ filter: new NativeRegExp('^task5-next-client-process$') }, () => ({ path: 'task5-next-client-process', namespace: 'task5-framework-host' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'task5-framework-host' }, () => ({ contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd() }));
      const utilImporters = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && utilImporters.has(path.resolve(args.importer)) ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(frameworkFilter.source, frameworkFilter.flags) }, args => { if (!args.importer) return undefined; const actual = createRequire(args.importer).resolve(args.path), browserFile = variants.get(actual); return browserFile ? { path: browserFile } : undefined; });
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'node-library-mobile-entry.tsx' } });
  const scripts = result.outputFiles.filter(f => f.path.endsWith('.js')), styles = result.outputFiles.filter(f => f.path.endsWith('.css'));
  if (scripts.length !== 1 || styles.length !== 1 || !styles[0].text.trim()) throw Error('NODE_LIBRARY_FIXTURE_MEMORY_BUNDLE'); bundle = scripts[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) }))); sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: process.cwd(), loadStylesheet: async (id: string, base: string) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } }); css = compiler.build(new Scanner({}).scanFiles(sources)) + '\n' + styles[0].text; browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => {
  const failures: string[] = []; for (const s of live) { try { await dispose(s); } catch (error) { failures.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { failures.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; } if (failures.length) throw Error(failures.join('\n'));
}, 15000);
async function bounded(name: string, operation: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('NODE_LIBRARY_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); } finally { if (timer) clearTimeout(timer); }
}
async function settle(page: Page): Promise<void> { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function session(theme: Theme = 'gold', width = 390, height = 844, options: Options = {}): Promise<Session> {
  if (!browser) throw Error('NODE_LIBRARY_FIXTURE_BROWSER_REQUIRED'); const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', ...(options.touch ? { hasTouch: true } : {}) }); contexts.add(context); let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), waiters: new Set(), mounted: false, canonicalUrl: null }; value = s; live.add(s);
    context.on('request', r => s.pending.add(r)); context.on('requestfinished', r => { s.pending.delete(r); s.completed.add(r); for (const notify of s.waiters) notify(); }); context.on('requestfailed', r => { s.pending.delete(r); s.failed.add(r); for (const notify of s.waiters) notify(); });
    page.on('pageerror', e => s.errors.push(String(e))); page.on('dialog', dialog => { s.errors.push('NODE_LIBRARY_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('NODE_LIBRARY_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key']) throw Error('NODE_LIBRARY_FIXTURE_HTTP_BOUNDARY');
        const key = request.method() + ' ' + url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count); if (count !== 1) throw Error('NODE_LIBRARY_FIXTURE_HTTP_COUNT ' + key);
        if (key === 'GET /' && request.isNavigationRequest() && request.postData() === null) { await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return; }
        if (key === 'GET /api/skills?surface=workflow' && request.postData() === null) { await route.fulfill({ json: { skills: [] } }); return; }
        if (key === 'POST /api/assets' && ['allow', 'deny'].includes(options.asset ?? '')) {
          if (headers['content-type'] !== 'application/json' || headers['x-wujie-expected-actor-id'] !== 'ui-node-actor' || request.postData() !== JSON.stringify({ projectId: 'ui-node-project', assetVersionId: 'ui-source-version', placementId: 'ui-source-placement' })) throw Error('NODE_LIBRARY_FIXTURE_ASSET_IDENTITY');
          if (options.asset === 'deny') { await route.fulfill({ status: 403, json: { code: 'DOCUMENT_FORBIDDEN' } }); return; }
          const png = await page.evaluate(() => { const e = document.createElement('canvas'); e.width = e.height = 48; const c = e.getContext('2d')!; c.fillStyle = '#be123c'; c.fillRect(0, 0, 48, 48); return e.toDataURL(); }); s.canonicalUrl = png;
          await route.fulfill({ json: { url: png, assetId: 'ui-source-asset', assetVersionId: 'ui-source-version', placementId: 'ui-source-placement' } }); return;
        }
        throw Error('NODE_LIBRARY_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle }); await page.evaluate(({ theme, options }) => (window as unknown as FixtureWindow).nodeLibrary.mount(theme, options), { theme, options }); s.mounted = true;
    await page.getByRole('toolbar', { name: '工作流工具栏' }).waitFor(); await expect.poll(() => s.counts.get('GET /api/skills?surface=workflow'), { timeout: 1500 }).toBe(1); await nativeFinished(s); await settle(page); return s;
  } catch (error) { try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } } catch (cleanup) { throw new AggregateError([error, cleanup], 'NODE_LIBRARY_FIXTURE_BOOTSTRAP'); } throw error; }
}
async function nativeFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined; try { await bounded('native requests', () => new Promise<void>(resolve => { notify = () => { if (!s.pending.size) resolve(); }; s.waiters.add(notify); notify(); })); } finally { if (notify) s.waiters.delete(notify); }
}
async function dispose(s: Session, refusal?: 'http' | 'websocket', cleanupProbe?: () => void): Promise<void> {
  const failures: unknown[] = [];
  try { if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).nodeLibrary.unmount())); cleanupProbe?.(); } catch (e) { failures.push(e); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); await nativeFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (e) { failures.push(e); }
  const pending = s.pending.size !== 0 || s.handlers.size !== 0; try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (e) { failures.push(e); }
  const invalid = (code: string): never => { if (failures.length) throw new AggregateError([Error(code), ...failures], 'NODE_LIBRARY_FIXTURE_VALIDATION_AND_CLEANUP'); throw Error(code); };
  const expected = ['GET /', 'GET /api/skills?surface=workflow']; if (['allow', 'deny'].includes(s.options.asset ?? '')) expected.push('POST /api/assets'); if (refusal === 'http') expected.push('GET /unexpected');
  if (JSON.stringify([...s.counts.keys()].sort()) !== JSON.stringify(expected.sort()) || [...s.counts.values()].some(n => n !== 1)) invalid('NODE_LIBRARY_FIXTURE_REQUEST_VALIDATION');
  const failed = [...s.failed], refused = [...s.refused], key = (r: Request): string => r.method() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search;
  if (pending || s.pending.size || (refusal === 'http' ? failed.length !== 1 || refused.length !== 1 || failed[0] !== refused[0] || key(failed[0]) !== 'GET /unexpected' : failed.length !== 0 || refused.length !== 0)
    || JSON.stringify([...s.completed].map(key).sort()) !== JSON.stringify(expected.filter(k => k !== 'GET /unexpected').sort())) invalid('NODE_LIBRARY_FIXTURE_NATIVE_REQUEST_FAILURE');
  if (failures.length) throw Error('NODE_LIBRARY_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (refusal) { const e = refusal === 'http' ? 'Error: NODE_LIBRARY_FIXTURE_UNKNOWN_HTTP GET /unexpected' : 'NODE_LIBRARY_FIXTURE_UNKNOWN_WS'; if (s.errors.length !== 1 || s.errors[0] !== e) throw Error('NODE_LIBRARY_FIXTURE_UNEXPECTED_FAILURES'); }
  if (s.errors.length) throw Error('NODE_LIBRARY_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(theme: Theme, width: number, height: number, options: Options, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height, options); let primary: unknown; try { await run(s); } catch (e) { primary = e; }
  try { await dispose(s); } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'NODE_LIBRARY_FIXTURE_TEST_AND_CLEANUP'); throw cleanup; } if (primary) throw primary;
}
function toolbar(s: Session): Locator { return s.page.getByRole('toolbar', { name: '工作流工具栏' }); }
function directory(s: Session, tab: Directory): Locator { return s.page.getByRole('complementary', { name: TITLES[tab], exact: true }); }
async function reveal(s: Session, scroller: Locator, control: Locator, horizontal = false): Promise<void> {
  for (let i = 0; i < 8; i++) { const clip = await scroller.boundingBox(), r = await control.boundingBox(); if (!clip || !r) throw Error('NODE_LIBRARY_FIXTURE_SCROLL_RECT');
    const start = horizontal ? r.x : r.y, size = horizontal ? r.width : r.height, bound = horizontal ? clip.x : clip.y, available = horizontal ? clip.width : clip.height;
    if (start >= bound + 1 && start + size <= bound + available - 1) return;
    expect(available, 'scroller fits target').toBeGreaterThanOrEqual(size + 2); const delta = start < bound + 1 ? start - bound - 3 : start + size - bound - available + 3;
    await s.page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2); await s.page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta); await settle(s.page);
  } expect(false, 'native scroll reaches action').toBe(true);
}
async function target(control: Locator): Promise<void> {
  const value = await control.evaluate(e => { const r = e.getBoundingClientRect(); let clear = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let p = e.parentElement; p; p = p.parentElement) { const b = p.getBoundingClientRect(), s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && (r.left < b.left + p.clientLeft - 0.5 || r.right > b.left + p.clientLeft + p.clientWidth + 0.5)) clear = false; if (/(auto|scroll|hidden|clip)/.test(s.overflowY) && (r.top < b.top + p.clientTop - 0.5 || r.bottom > b.top + p.clientTop + p.clientHeight + 0.5)) clear = false; }
    const x = r.x + r.width / 2, y = r.y + r.height / 2; return { width: r.width, height: r.height, clear, hit: [[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b]) => e.contains(document.elementFromPoint(a,b))) }; });
  expect(value.width, 'target width').toBeGreaterThanOrEqual(44); expect(value.height, 'target height').toBeGreaterThanOrEqual(44); expect(value.clear, 'whole target visible').toBe(true); expect(value.hit, 'native hit').toBe(true);
}
async function open(s: Session, tab: Directory): Promise<Locator> {
  const name = tab === 'material' ? '切换素材库面板' : tab === 'prompts' ? '切换提示词库面板' : '预设工作流'; const button = s.page.getByRole('button', { name, exact: true });
  await reveal(s, toolbar(s), button, true); await button.click(); await settle(s.page); const panel = directory(s, tab); expect(await panel.count(), 'selected directory is rendered').toBe(1); return panel;
}
async function clickPanel(s: Session, panel: Locator, button: Locator): Promise<void> { await reveal(s, panel.locator('[data-workflow-library-scroll]'), button); await target(button); await button.click(); await settle(s.page); }
async function workflow(s: Session): Promise<Workflow> { const value = await s.page.evaluate(() => (window as unknown as FixtureWindow).nodeLibrary.state.workflow); if (!value) throw Error('NODE_LIBRARY_FIXTURE_CONSUMER_CALLBACK'); return value; }
async function undo(s: Session): Promise<void> { const button = s.page.getByRole('button', { name: '撤销', exact: true }); await reveal(s, toolbar(s), button, true); await button.click(); await settle(s.page); }
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/mobile-ui/node-library-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_LIBRARY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }
describe('node library switching', () => {
  it.each(THEMES.flatMap(theme => (['material','prompts','presets'] as const).map(tab => ({ theme, tab }))))('$theme $tab renders real content not only a pressed icon', async ({ theme, tab }) => {
    await withSession(theme,390,844,{},async s => { const panel = await open(s,tab); const text = tab==='material'?'离线规范素材':tab==='prompts'?'照片写实风格':'文本提示词生成图片'; expect(await panel.getByText(text,{exact:true}).count(), 'directory has its actual data').toBeGreaterThan(0); });
  },25000);
});
describe('node library mobile controls', () => {
  it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps directory tools and closure usable',async({theme,width,height})=>{
    await withSession(theme,width,height,{},async s=>{
      for(const name of ['预设工作流','切换素材库面板','切换提示词库面板']){const entry=s.page.getByRole('button',{name,exact:true});await reveal(s,toolbar(s),entry,true);await target(entry);}
      for(const tab of ['material','prompts','presets'] as const){const panel=await open(s,tab);const search=panel.getByRole('textbox');await target(search);expect(await search.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);const close=panel.getByRole('button',{name:'关闭目录面板',exact:true});await target(close);await capture(s,theme+'-'+width+'x'+height+'-'+tab);await close.click();expect(await panel.count()).toBe(0);}
    });
  },25000);
});
describe('node library prompt use',()=>{
  it.each(THEMES)('%s creates one text node from the unified library and undoes without changing templates',async theme=>{
    await withSession(theme,320,640,{},async s=>{const panel=await open(s,'prompts');const before=await s.page.evaluate(()=>localStorage.getItem('wujie_prompt_templates'));await clickPanel(s,panel,panel.getByRole('button',{name:'使用提示词 照片写实风格',exact:true}));const wf=await workflow(s);expect(wf.nodes).toHaveLength(1);expect(wf.nodes[0].type).toBe('input-text');expect(wf.nodes[0].config.text).toContain('photorealistic image of {subject}');expect(await s.page.evaluate(()=>localStorage.getItem('wujie_prompt_templates'))).toBe(before);await undo(s);expect((await workflow(s)).nodes).toHaveLength(0);});
  },25000);
});
describe('node library preset use',()=>{
  it.each(THEMES)('%s protects existing nodes on cancel and makes replacement undoable',async theme=>{
    await withSession(theme,390,844,{initial:true},async s=>{const before=JSON.stringify(await workflow(s));let panel=await open(s,'presets');await clickPanel(s,panel,panel.getByRole('button',{name:'加载预设 文生图',exact:true}));let dialog=s.page.getByRole('dialog',{name:'替换当前工作流',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(JSON.stringify(await workflow(s))).toBe(before);panel=directory(s,'presets');await clickPanel(s,panel,panel.getByRole('button',{name:'加载预设 文生图',exact:true}));dialog=s.page.getByRole('dialog',{name:'替换当前工作流',exact:true});await dialog.getByRole('button',{name:'替换工作流',exact:true}).click();await settle(s.page);const after=await workflow(s);expect(after.nodes.map(n=>n.type)).toEqual(['input-text','ai-generate','output-image']);expect(after.connections).toHaveLength(2);await undo(s);expect(JSON.stringify(await workflow(s))).toBe(before);});
  },25000);
});
describe('node library material use',()=>{
  it.each(THEMES)('%s resolves the exact document asset before accepting an image node',async theme=>{
    await withSession(theme,390,844,{asset:'allow'},async s=>{const panel=await open(s,'material');await clickPanel(s,panel,panel.getByRole('button',{name:'添加素材 离线规范素材',exact:true}));await s.page.waitForFunction(()=>{const n=(window as unknown as FixtureWindow).nodeLibrary.state.workflow?.nodes[0];return n?.config.assetTransferPending===false&&n.config.assetVersionId==='ui-source-version';});const wf=await workflow(s);expect(wf.nodes).toHaveLength(1);expect(wf.nodes[0].type).toBe('input-image');expect(wf.nodes[0].config).toMatchObject({projectId:'ui-node-project',assetVersionId:'ui-source-version',placementId:'ui-source-placement',assetTransferPending:false});expect(s.canonicalUrl).toMatch(/^data:image\/png/);expect(wf.nodes[0].config.imageUrl).toBe(s.canonicalUrl);});
  },25000);
  it.each(['deny','scope'] as const)('refuses %s assets without retaining the untrusted reference',async asset=>{
    await withSession('gold',390,844,{asset},async s=>{const panel=await open(s,'material');await clickPanel(s,panel,panel.getByRole('button',{name:'添加素材 离线规范素材',exact:true}));await s.page.getByText('协作图片权限或版本已变化，请重新选择',{exact:true}).waitFor();const wf=await workflow(s);expect(wf.nodes[0].config.imageUrl).toBe('');expect(wf.nodes[0].config.assetVersionId).toBeUndefined();expect(wf.nodes[0].config.assetTransferPending).toBe(false);});
  },25000);
});
describe('node library directory state',()=>{
  it.each(THEMES)('%s searches each real directory and recovers from empty results',async theme=>{
    await withSession(theme,320,640,{},async s=>{for(const tab of ['material','prompts','presets'] as const){const panel=await open(s,tab),search=panel.getByRole('textbox');await search.fill('不存在XYZ');await panel.getByText('没有匹配的内容',{exact:true}).waitFor();await search.fill('');expect(await panel.getByText('没有匹配的内容',{exact:true}).count()).toBe(0);}});
  },25000);
  it.each(THEMES)('%s keeps a directory reachable across rotation and recovers after closing',async theme=>{
    await withSession(theme,390,844,{},async s=>{await open(s,'presets');await s.page.setViewportSize({width:640,height:320});await settle(s.page);const panel=await open(s,'prompts');expect(await panel.getByText('照片写实风格',{exact:true}).count()).toBe(1);await panel.getByRole('button',{name:'关闭目录面板',exact:true}).click();await s.page.setViewportSize({width:390,height:844});await settle(s.page);await open(s,'material');});
  },25000);
  it.each(THEMES)('%s renders desktop directories without losing the existing workflow',async theme=>{
    await withSession(theme,1440,900,{initial:true},async s=>{const before=JSON.stringify(await workflow(s));for(const tab of ['material','prompts','presets'] as const)await open(s,tab);expect(JSON.stringify(await workflow(s))).toBe(before);await capture(s,theme+'-desktop');});
  },25000);
});
describe('node library native scrolling',()=>{
  it.each(THEMES)('%s scrolls to an initially offscreen real last preset and can cancel it',async theme=>{
    await withSession(theme,320,640,{initial:true},async s=>{const before=JSON.stringify(await workflow(s)),panel=await open(s,'presets'),scroll=panel.locator('[data-workflow-library-scroll]'),last=panel.getByRole('button',{name:/^加载预设 /}).last();const clip=await scroll.boundingBox(),start=await last.boundingBox();if(!clip||!start)throw Error('NODE_LIBRARY_FIXTURE_SCROLL_RECT');expect(await scroll.evaluate(e=>e.scrollTop)).toBe(0);expect(start.y+start.height,'last real item starts offscreen').toBeGreaterThan(clip.y+clip.height);await reveal(s,scroll,last);await target(last);expect(await scroll.evaluate(e=>e.scrollTop),'native wheel actually moved list').toBeGreaterThan(0);await last.click();await settle(s.page);await s.page.getByRole('dialog',{name:'替换当前工作流',exact:true}).getByRole('button',{name:'取消',exact:true}).click();expect(JSON.stringify(await workflow(s))).toBe(before);});
  },25000);
});
describe('node library short content',()=>{
  it.each(THEMES.flatMap(theme=>(['material','prompts','presets'] as const).map(tab=>({theme,tab}))))('$theme $tab leaves a complete action row reachable in short landscape',async({theme,tab})=>{
    await withSession(theme,640,320,{},async s=>{const panel=await open(s,tab),scroll=panel.locator('[data-workflow-library-scroll]');const size=await scroll.boundingBox();if(!size)throw Error('NODE_LIBRARY_FIXTURE_SCROLL_RECT');expect(size.height,'short library scroll fits an action').toBeGreaterThanOrEqual(46);const name=tab==='material'?'添加素材 离线规范素材':tab==='prompts'?'使用提示词 照片写实风格':'加载预设 文生图',action=panel.getByRole('button',{name,exact:true});await reveal(s,scroll,action);await target(action);});
  },25000);
});
describe('node library selected-node return',()=>{
  it.each(THEMES)('%s can reopen and hit the directory above selected-node properties',async theme=>{
    await withSession(theme,320,640,{},async s=>{const prompts=await open(s,'prompts');await clickPanel(s,prompts,prompts.getByRole('button',{name:'使用提示词 照片写实风格',exact:true}));const before=JSON.stringify(await workflow(s)),panel=await open(s,'material'),action=panel.getByRole('button',{name:'添加素材 离线规范素材',exact:true});await reveal(s,panel.locator('[data-workflow-library-scroll]'),action);await target(action);await panel.getByRole('button',{name:'关闭目录面板',exact:true}).click();expect(JSON.stringify(await workflow(s))).toBe(before);});
  },25000);
});
describe('node library review reopening',()=>{
  it.each(THEMES.flatMap(theme=>(['material','prompts','presets'] as const).map(tab=>({theme,tab}))))('$theme $tab reopens the same directory after its close button',async({theme,tab})=>{
    await withSession(theme,390,844,{},async s=>{let panel=await open(s,tab);await panel.getByRole('button',{name:'关闭目录面板',exact:true}).click();expect(await panel.count()).toBe(0);panel=await open(s,tab);await target(panel.getByRole('button',{name:'关闭目录面板',exact:true}));});
  },25000);
});
describe('node library review overlay',()=>{
  it.each(THEMES)('%s keeps the existing JSON modal above an open directory',async theme=>{
    await withSession(theme,390,844,{},async s=>{const panel=await open(s,'material'),entry=toolbar(s).locator('button[title="查看/编辑JSON"]');await reveal(s,toolbar(s),entry,true);await entry.click();await settle(s.page);const modal=s.page.getByText('工作流 JSON 编辑器',{exact:true}).locator('../../..'),handle=await modal.elementHandle();if(!handle)throw Error('NODE_LIBRARY_FIXTURE_MODAL_MISSING');const covered=await panel.getByRole('button',{name:'关闭目录面板',exact:true}).evaluate((e,overlay)=>{const r=e.getBoundingClientRect();return overlay.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));},handle);expect(covered,'modal stays above directory').toBe(true);await modal.getByRole('button',{name:'取消',exact:true}).click();await settle(s.page);await target(panel.getByRole('button',{name:'关闭目录面板',exact:true}));});
  },25000);
});
describe('node library review confirmation',()=>{
  it.each(THEMES)('%s keeps every visible replacement-dialog action touch-sized',async theme=>{
    await withSession(theme,390,844,{initial:true},async s=>{const before=JSON.stringify(await workflow(s)),panel=await open(s,'presets');await clickPanel(s,panel,panel.getByRole('button',{name:'加载预设 文生图',exact:true}));const dialog=s.page.getByRole('dialog',{name:'替换当前工作流',exact:true});for(const button of await dialog.getByRole('button').all())await target(button);await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(JSON.stringify(await workflow(s))).toBe(before);});
  },25000);
});
describe('node library review feedback',()=>{
  it.each(THEMES)('%s keeps exactly the visible directory highlighted through switching and closure',async theme=>{
    await withSession(theme,390,844,{},async s=>{const names=['切换节点库面板','切换素材库面板','切换提示词库面板','预设工作流'];const check=async():Promise<void>=>{for(const name of names){const entry=s.page.getByRole('button',{name,exact:true});expect(await entry.evaluate(e=>{const pressed=e.getAttribute('aria-pressed')==='true';return e.classList.contains('bg-primary/10')===pressed&&e.classList.contains('text-primary')===pressed;}),'visual and pressed state agree').toBe(true);}};for(const tab of ['material','prompts','presets'] as const){const panel=await open(s,tab);await check();await panel.getByRole('button',{name:'关闭目录面板',exact:true}).click();await check();}const node=s.page.getByRole('button',{name:'切换节点库面板',exact:true});await reveal(s,toolbar(s),node,true);await node.click();await settle(s.page);await check();await capture(s,theme+'-review-feedback');});
  },25000);
});
describe('node library fixture boundary',()=>{
  it('preserves request and cleanup faults together rather than losing either diagnostic',async()=>{
    const s=await session('gold',390,844,{asset:'allow'});let failure:unknown;try{await dispose(s,undefined,()=>{throw Error('NODE_LIBRARY_FIXTURE_INJECTED_CLEANUP');});}catch(e){failure=e;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors.map(String)).toEqual(['Error: NODE_LIBRARY_FIXTURE_REQUEST_VALIDATION','Error: NODE_LIBRARY_FIXTURE_INJECTED_CLEANUP']);expect(live.has(s)).toBe(false);
  },25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{
    const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* expected */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const socket=new WebSocket('wss://unexpected.invalid');const timer=setTimeout(()=>reject(Error('NODE_LIBRARY_FIXTURE_WS_TIMEOUT')),1500);socket.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'NODE_LIBRARY_FIXTURE_INFRASTRUCTURE: Error: NODE_LIBRARY_FIXTURE_UNKNOWN_HTTP GET /unexpected':'NODE_LIBRARY_FIXTURE_INFRASTRUCTURE: NODE_LIBRARY_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}
  },25000);
  it.each(['http','websocket'] as const)('cannot absorb cleanup failure into expected %s refusal',async transport=>{
    const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* expected */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const socket=new WebSocket('wss://unexpected.invalid');const timer=setTimeout(()=>reject(Error('NODE_LIBRARY_FIXTURE_WS_TIMEOUT')),1500);socket.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('NODE_LIBRARY_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('NODE_LIBRARY_FIXTURE_CLEANUP_FAILURE: Error: NODE_LIBRARY_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}
  },25000);
});

describe('QN mobile advertising preset load', (): void => {
  it.each([
    { theme: 'gold' as const, width: 320, height: 640 },
    { theme: 'mono' as const, width: 640, height: 320 },
  ])('$theme $width x $height publishes a compatible seven-scene graph through the real directory', async ({ theme, width, height }): Promise<void> => {
    await withSession(theme, width, height, { initial: true, touch: true }, async (s: Session): Promise<void> => {
      expect(await s.page.evaluate(() => navigator.maxTouchPoints), 'QN_TOUCH_CONTEXT_REQUIRED').toBeGreaterThan(0);
      const panel = await open(s, 'presets');
      const choice = panel.getByRole('button', { name: '加载预设 电商广告7段分镜', exact: true });
      await reveal(s, panel.locator('[data-workflow-library-scroll]'), choice);
      await target(choice);
      await choice.tap();
      const dialog = s.page.getByRole('dialog', { name: '替换当前工作流', exact: true });
      await dialog.waitFor();
      const apply = dialog.getByRole('button', { name: '替换工作流', exact: true });
      await expect.poll(async (): Promise<boolean> => apply.evaluate(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return box.width >= 44 && box.height >= 44 && Number(style.opacity) >= 0.99;
      })).toBe(true);
      await target(apply);
      await apply.tap();
      await expect.poll(async (): Promise<string> => (await workflow(s)).name).toBe('电商广告7段分镜');
      await expect.poll(async (): Promise<number> => directory(s, 'presets').count()).toBe(0);
      const graph = await workflow(s);
      const { isWorkflowConnectionValid } = await import('@/lib/workflow-engine');
      expect(graph.nodes).toHaveLength(13);
      expect(graph.connections).toHaveLength(19);
      expect(graph.connections.filter(edge => !isWorkflowConnectionValid(graph, edge)), 'QN_NATIVE_PRESET_VALID_PORTS').toEqual([]);
      const script = graph.nodes.find(node => node.type === 'ai-llm')!;
      expect(graph.connections.filter(edge => edge.fromNodeId === script.id && edge.type === 'prompt')).toHaveLength(8);
      await capture(s, 'qn-' + theme + '-' + width + 'x' + height + '-advertising-preset');
      console.log('QN_NATIVE_PRESET_GRAPH ' + JSON.stringify({ theme, width, height, touch: true, nodes: graph.nodes.length, edges: graph.connections.length, invalid: 0 }));
    });
  }, 25000);
});
