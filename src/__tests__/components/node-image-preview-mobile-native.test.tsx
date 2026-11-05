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
import type { Workflow, NodeType } from '@/lib/workflow-engine';

type Theme = 'gold' | 'mono';
interface Options { preview?: boolean; asset?: 'allow' | 'deny' | 'scope'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean }
interface FixtureWindow extends Window { nodeProperty: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null; imageReads: number; downloadReads: number; releasePreview: () => void }
const ORIGIN = 'https://node-property-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import NodeEditor from '@/components/node-editor';
import {createEmptyWorkflow,createWorkflowNode,type Workflow,type NodeType} from '@/lib/workflow-engine';
import type {TaskModelDescriptor} from '@/lib/task-core/model-capability-contract';
import type {TaskModelCatalogModel} from '@/hooks/use-task-model-catalog';
const offlineModelCatalog:TaskModelDescriptor[]=[
 {providerId:'ui-vision-provider',modelId:'ui-vision-model',kind:'chat',sourceType:'chat',protocol:'chat-completions',executionMode:'sync',supportsVision:true,allowedRatios:[],allowedSizes:[],qualityOptions:[],maxOutputs:1,supportsReferenceImages:false,supportsMask:false,outputKinds:['text'],capabilitySources:{}},
 {providerId:'ui-image-provider',modelId:'ui-image-model',kind:'image',sourceType:'image',protocol:'openai-images',executionMode:'sync',allowedRatios:['1:1','4:3'],allowedSizes:[],qualityOptions:['standard'],maxOutputs:1,supportsReferenceImages:true,maxReferenceImages:1,supportsMask:false,supportedOperations:['image-to-image'],outputKinds:['image'],capabilitySources:{}}
];
const offlineModelOptions:TaskModelCatalogModel[]=[
 {id:'ui-vision-model',name:'离线视觉模型',type:'chat',providerId:'ui-vision-provider',providerName:'离线视觉供应商'},
 {id:'ui-image-model',name:'离线图像模型',type:'image',providerId:'ui-image-provider',providerName:'离线图像供应商'}
];
const root=createRoot(document.getElementById('fixture-root')!);
const state={workflow:null as Workflow|null,disposed:false};let mounted=false;
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{preview?:boolean;asset?:string;nodeType?:NodeType;config?:Record<string,unknown>;modelFixtures?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)throw Error('NODE_PROPERTY_FIXTURE_CANVAS');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,48,48);const url=canvas.toDataURL();
 const workflow={...createEmptyWorkflow('离线目录验收工作流'),id:'ui-node-workflow'};
 const node=createWorkflowNode(options.nodeType||'input-param',40,60,'离线属性节点');node.config={...node.config,...options.config,...(options.preview?{imageUrl:'https://node-property-mobile.invalid/test-media/source.png',source:'url'}:{})};workflow.nodes=[node];
 const images=[{id:'ui-source-image',url,name:'离线规范素材',description:'离线规范素材',width:48,height:48,assetId:'ui-source-asset',assetVersionId:'ui-source-version',placementId:'ui-source-placement',projectId:options.asset==='scope'?'ui-other-project':'ui-node-project'}];
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
 root.render(<NodeEditor taskModelCatalog={options.modelFixtures?offlineModelCatalog:[]} taskModelOptions={options.modelFixtures?offlineModelOptions:[]} workflow={workflow} userId="ui-node-actor" projectId="ui-node-project" canvasDocumentMode themeStyle={theme==='mono'?'monochrome':'gold'} canvasImages={images}
 onWorkflowChange={value=>{state.workflow=value;}} onBack={()=>{throw Error('NODE_PROPERTY_FIXTURE_UNEXPECTED_NAVIGATION')}}/>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = ''; let previewPng: Buffer;
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('NODE_PROPERTY_FIXTURE_NATIVE_LOADER');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  previewPng = await (require('sharp') as typeof import('sharp')['default'])({create:{width:48,height:48,channels:4,background:'#2563eb'}}).png().toBuffer();
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const result = await build({ write: false, outfile: 'node-property-fixture.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
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
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'node-property-mobile-entry.tsx' } });
  const scripts = result.outputFiles.filter(f => f.path.endsWith('.js')), styles = result.outputFiles.filter(f => f.path.endsWith('.css'));
  if (scripts.length !== 1 || styles.length !== 1 || !styles[0].text.trim()) throw Error('NODE_PROPERTY_FIXTURE_MEMORY_BUNDLE'); bundle = scripts[0].text;
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
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('NODE_PROPERTY_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); } finally { if (timer) clearTimeout(timer); }
}
async function settle(page: Page): Promise<void> { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function session(theme: Theme = 'gold', width = 390, height = 844, options: Options = {}): Promise<Session> {
  if (!browser) throw Error('NODE_PROPERTY_FIXTURE_BROWSER_REQUIRED'); const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: width < 1000, isMobile: false }); contexts.add(context); let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), waiters: new Set(), mounted: false, canonicalUrl: null, imageReads: 0, downloadReads: 0, releasePreview: () => undefined }; value = s; live.add(s);
    context.on('request', r => s.pending.add(r)); context.on('requestfinished', r => { s.pending.delete(r); s.completed.add(r); for (const notify of s.waiters) notify(); }); context.on('requestfailed', r => { s.pending.delete(r); s.failed.add(r); for (const notify of s.waiters) notify(); });
    page.on('pageerror', e => s.errors.push(String(e))); page.on('dialog', dialog => { s.errors.push('NODE_PROPERTY_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('NODE_PROPERTY_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key']) throw Error('NODE_PROPERTY_FIXTURE_HTTP_BOUNDARY');
        const key = request.method() + ' ' + url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count); if (count !== 1 && !(options.preview && key === 'GET /test-media/source.png' && count <= 8)) throw Error('NODE_PROPERTY_FIXTURE_HTTP_COUNT ' + key);
        if (key === 'GET /' && request.isNavigationRequest() && request.postData() === null) { await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return; }
        if (key === 'GET /api/skills?surface=workflow' && request.postData() === null) { await route.fulfill({ json: { skills: [] } }); return; }
        if (options.preview && key === 'GET /test-media/source.png' && request.postData() === null) {
          if(request.resourceType()==='image'){
            s.imageReads++; if(s.imageReads>5)throw Error('HS_PREVIEW_IMAGE_READ_CAP');
            await route.fulfill({contentType:'image/png',headers:{'cache-control':'no-store'},body:previewPng});return;
          }
          if(request.resourceType()!=='fetch')throw Error('HS_PREVIEW_REQUEST_KIND');
          s.downloadReads++;if(s.downloadReads>3)throw Error('HS_PREVIEW_DOWNLOAD_READ_CAP');
          if(s.downloadReads===1)await new Promise<void>(resolve=>{s.releasePreview=resolve;});
          if(s.downloadReads===2){await route.fulfill({status:503,json:{error:'isolated preview read failure'}});return;}
          await route.fulfill({contentType:'image/png',body:previewPng});return;
        }
        if(options.preview && key === 'POST /api/save-image'){
          if(s.downloadReads!==2 || headers['content-type']!=='application/json'
            || request.postData()!==JSON.stringify({imageUrl:ORIGIN+'/test-media/source.png'}))throw Error('HS_PREVIEW_FALLBACK_BODY_OR_ORDER');
          await route.fulfill({status:503,json:{success:false,error:'isolated persist unavailable'}});return;
        }
        if (key === 'POST /api/assets' && ['allow', 'deny'].includes(options.asset ?? '')) {
          if (headers['content-type'] !== 'application/json' || headers['x-wujie-expected-actor-id'] !== 'ui-node-actor' || request.postData() !== JSON.stringify({ projectId: 'ui-node-project', assetVersionId: 'ui-source-version', placementId: 'ui-source-placement' })) throw Error('NODE_PROPERTY_FIXTURE_ASSET_IDENTITY');
          if (options.asset === 'deny') { await route.fulfill({ status: 403, json: { code: 'DOCUMENT_FORBIDDEN' } }); return; }
          const png = await page.evaluate(() => { const e = document.createElement('canvas'); e.width = e.height = 48; const c = e.getContext('2d')!; c.fillStyle = '#be123c'; c.fillRect(0, 0, 48, 48); return e.toDataURL(); }); s.canonicalUrl = png;
          await route.fulfill({ json: { url: png, assetId: 'ui-source-asset', assetVersionId: 'ui-source-version', placementId: 'ui-source-placement' } }); return;
        }
        throw Error('NODE_PROPERTY_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle }); await page.evaluate(({ theme, options }) => (window as unknown as FixtureWindow).nodeProperty.mount(theme, options), { theme, options }); s.mounted = true;
    await page.getByRole('toolbar', { name: '工作流工具栏' }).waitFor(); await expect.poll(() => s.counts.get('GET /api/skills?surface=workflow'), { timeout: 1500 }).toBe(1); await nativeFinished(s); await settle(page); console.log('NODE_PROPERTY_FIXTURE_GEOMETRY',JSON.stringify(await page.evaluate(()=>{const rect=(q:string)=>{const r=document.querySelector(q)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;};return{root:rect('.node-editor-root'),canvas:rect('[data-workflow-legacy-surface]'),card:rect('[data-node-id]')};}))); return s;
  } catch (error) { try { if (value) await dispose(value,undefined,undefined,true); else { await context.close(); contexts.delete(context); } } catch (cleanup) { throw new AggregateError([error, cleanup], 'NODE_PROPERTY_FIXTURE_BOOTSTRAP'); } throw error; }
}
async function nativeFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined; try { await bounded('native requests', () => new Promise<void>(resolve => { notify = () => { if (!s.pending.size) resolve(); }; s.waiters.add(notify); notify(); })); } finally { if (notify) s.waiters.delete(notify); }
}
async function dispose(s: Session, refusal?: 'http' | 'websocket', cleanupProbe?: () => void, primaryFailure = false): Promise<void> {
  const failures: unknown[] = []; s.releasePreview();
  try { if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).nodeProperty.unmount())); cleanupProbe?.(); } catch (e) { failures.push(e); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); await nativeFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (e) { failures.push(e); }
  const pending = s.pending.size !== 0 || s.handlers.size !== 0; try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (e) { failures.push(e); }
  const invalid = (code: string): never => { if (failures.length) throw new AggregateError([Error(code), ...failures], 'NODE_PROPERTY_FIXTURE_VALIDATION_AND_CLEANUP'); throw Error(code); };
  const partialPreview = primaryFailure && s.options.preview === true;
  const expected = ['GET /', 'GET /api/skills?surface=workflow']; if (['allow', 'deny'].includes(s.options.asset ?? '')) expected.push('POST /api/assets'); if (refusal === 'http') expected.push('GET /unexpected'); if(s.options.preview){if(!partialPreview||s.counts.has('GET /test-media/source.png'))expected.push('GET /test-media/source.png');if(!partialPreview||s.counts.has('POST /api/save-image'))expected.push('POST /api/save-image');}
  if (JSON.stringify([...s.counts.keys()].sort()) !== JSON.stringify(expected.sort()) || [...s.counts.entries()].some(([key,n]) => key==='GET /test-media/source.png' && s.options.preview ? n !== s.imageReads+s.downloadReads || s.imageReads>5 || s.downloadReads>3 || (!partialPreview&&(s.imageReads<1||s.downloadReads!==3)) : n!==1)) invalid('NODE_PROPERTY_FIXTURE_REQUEST_VALIDATION');
  const failed = [...s.failed], refused = [...s.refused], key = (r: Request): string => r.method() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search;
  if (pending || s.pending.size || (refusal === 'http' ? failed.length !== 1 || refused.length !== 1 || failed[0] !== refused[0] || key(failed[0]) !== 'GET /unexpected' : failed.length !== 0 || refused.length !== 0)
    || JSON.stringify([...s.completed].map(key).sort()) !== JSON.stringify(expected.filter(k => k !== 'GET /unexpected').flatMap(k=>s.options.preview&&k==='GET /test-media/source.png'?Array.from({length:s.imageReads+s.downloadReads},()=>k):[k]).sort())) invalid('NODE_PROPERTY_FIXTURE_NATIVE_REQUEST_FAILURE');
  if (failures.length) throw Error('NODE_PROPERTY_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (refusal) { const e = refusal === 'http' ? 'Error: NODE_PROPERTY_FIXTURE_UNKNOWN_HTTP GET /unexpected' : 'NODE_PROPERTY_FIXTURE_UNKNOWN_WS'; if (s.errors.length !== 1 || s.errors[0] !== e) throw Error('NODE_PROPERTY_FIXTURE_UNEXPECTED_FAILURES'); }
  if (s.errors.length) throw Error('NODE_PROPERTY_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(theme: Theme, width: number, height: number, options: Options, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height, options); let primary: unknown; try { await run(s); } catch (e) { primary = e; }
  try { await dispose(s,undefined,undefined,primary!==undefined); } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'NODE_PROPERTY_FIXTURE_TEST_AND_CLEANUP'); throw cleanup; } if (primary) throw primary;
}
function toolbar(s: Session): Locator { return s.page.getByRole('toolbar', { name: '工作流工具栏' }); }
async function reveal(s: Session, scroller: Locator, control: Locator, horizontal = false): Promise<void> {
  for (let i = 0; i < 8; i++) { const clip = await scroller.boundingBox(), r = await control.boundingBox(); if (!clip || !r) throw Error('NODE_PROPERTY_FIXTURE_SCROLL_RECT');
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
async function workflow(s: Session): Promise<Workflow> { const value = await s.page.evaluate(() => (window as unknown as FixtureWindow).nodeProperty.state.workflow); if (!value) throw Error('NODE_PROPERTY_FIXTURE_CONSUMER_CALLBACK'); return value; }
async function undo(s: Session): Promise<void> { const button = s.page.getByRole('button', { name: '撤销', exact: true }); await reveal(s, toolbar(s), button, true); await button.click(); await settle(s.page); }
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/playwright/node-property-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_PROPERTY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }

function properties(s:Session):Locator{return s.page.getByText('节点属性',{exact:true}).locator('../..');}
function propertyScroll(s:Session):Locator{return properties(s).locator(':scope > div').last();}
async function selectNode(s:Session):Promise<Locator>{const entry=s.page.getByRole('button',{name:'切换节点库面板',exact:true});if(await entry.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),entry,true);await entry.click();await settle(s.page);}const card=s.page.locator('[data-node-id][aria-label="离线属性节点"]');await card.waitFor();await card.click({position:{x:15,y:15}});await settle(s.page);await properties(s).getByRole('button',{name:'关闭节点属性',exact:true}).waitFor();return properties(s);}
async function propertyTarget(s:Session,control:Locator):Promise<void>{await reveal(s,propertyScroll(s),control);await target(control);}
async function inputSize(control:Locator):Promise<void>{expect(await control.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize)),'property input text size').toBeGreaterThanOrEqual(16);}


const HS_PREVIEW_CASES=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1040,720]].map(([width,height])=>({theme,width,height})));
async function activate(s:Session,control:Locator):Promise<void>{
 if(s.page.viewportSize()!.width<1000)await control.tap();else await control.click();await settle(s.page);
}
async function openedPreview(s:Session,stage:'initial'|'reopen'):Promise<{image:Locator;close:Locator;download:Locator;overlay:Locator}>{
 const library=toolbar(s).getByRole('button',{name:'切换节点库面板',exact:true});
 if(await library.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),library,true);await activate(s,library);}
 const propertyClose=s.page.getByRole('button',{name:'关闭节点属性',exact:true});if(await propertyClose.isVisible())await activate(s,propertyClose);
 const thumb=s.page.locator('[data-node-id] img[src="'+ORIGIN+'/test-media/source.png"]');
 expect(await thumb.count(),'one owned source thumbnail').toBe(1);
 await thumb.waitFor();await expect.poll(()=>thumb.evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);
 const view=s.page.viewportSize()!,theme=await s.page.evaluate(()=>document.documentElement.classList.contains('theme-gold')?'gold':'mono');
 await capture(s,'hs-r4-'+theme+'-'+view.width+'-'+view.height+'-'+stage+'-entry');
 const entry=thumb.locator('..');expect(await entry.count(),'one existing preview click owner').toBe(1);await activate(s,entry);
 const close=s.page.getByRole('button',{name:'关闭预览',exact:true});await close.waitFor();expect(await close.count(),'one active preview close action').toBe(1);
 const image=close.locator('..').getByRole('img',{name:'预览',exact:true});await image.waitFor();
 await expect.poll(()=>image.evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);
 return{image,close,download:s.page.getByRole('button',{name:'下载预览图片',exact:true}),overlay:image.locator('../..')};
}
async function takeDownload(s:Session,receive:Promise<import('@playwright/test').Download>):Promise<void>{
 const downloaded=await receive;expect(await downloaded.failure(),'browser download completed').toBeNull();
 expect(downloaded.suggestedFilename()).toBe('wujie-workflow-result.png');
 const file=await downloaded.path();if(!file)throw Error('HS_PREVIEW_DOWNLOAD_PATH');
 expect((await readFile(file)).equals(previewPng),'actual downloaded bytes match owned image').toBe(true);
}
describe('HS N11 real-node image-preview existing download flow',()=>{
 it.each(HS_PREVIEW_CASES)('$theme $width x $height preserves graph through held download error retry close and reopen',async({theme,width,height})=>{
  await withSession(theme,width,height,{preview:true,nodeType:'input-image'},async s=>{
   const before=JSON.stringify(await workflow(s)),p=await openedPreview(s,'initial');
   const controls=await Promise.all([p.download,p.close].map(async b=>({label:await b.getAttribute('aria-label'),rect:await b.boundingBox(),area:await b.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{visible:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:[[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b])=>e.contains(document.elementFromPoint(a,b)))};})})));
   console.log('HS_PREVIEW_OPENED',JSON.stringify({theme,width,height,controls,image:await p.image.boundingBox(),physicalAndroid:false}));
   await capture(s,'hs-r4-preview-'+theme+'-'+width+'-'+height+'-opened');
   const first=s.page.waitForEvent('download',{timeout:1500});void first.catch(()=>undefined);
   await activate(s,p.download);
   await expect.poll(()=>s.downloadReads,{timeout:1500}).toBe(1);
   expect(await p.download.isDisabled(),'pending download cannot be resubmitted').toBe(true);
   expect(await p.download.locator('.animate-spin').isVisible(),'pending action shows progress').toBe(true);
   const point=await p.download.boundingBox();if(!point)throw Error('HS_PREVIEW_DOWNLOAD_RECT');
   if(width<1000)await s.page.touchscreen.tap(point.x+point.width/2,point.y+point.height/2);else await s.page.mouse.click(point.x+point.width/2,point.y+point.height/2);
   await settle(s.page);expect(s.downloadReads,'disabled native second activation makes no duplicate read').toBe(1);
   s.releasePreview();await takeDownload(s,first);
   await expect.poll(()=>p.download.isEnabled(),{timeout:1500}).toBe(true);
   expect(await p.image.isVisible(),'download action does not close preview').toBe(true);
   await activate(s,p.download);await s.page.getByRole('alert').waitFor();
   expect(await s.page.getByRole('alert').innerText()).toMatch(/下载失败/);
   expect(await p.download.isEnabled(),'error allows original retry action').toBe(true);
   expect(s.counts.get('POST /api/save-image'),'one exact fallback attempt').toBe(1);
   const retry=s.page.waitForEvent('download',{timeout:1500});void retry.catch(()=>undefined);
   await activate(s,p.download);await takeDownload(s,retry);
   await expect.poll(()=>p.download.isEnabled(),{timeout:1500}).toBe(true);
   expect(await s.page.getByRole('alert').count(),'successful retry clears error').toBe(0);
   await activate(s,p.close);await expect.poll(()=>p.image.isVisible(),{timeout:1500}).toBe(false);
   const reopened=await openedPreview(s,'reopen');await settle(s.page);
   if(width<1000)await s.page.touchscreen.tap(6,6);else await s.page.mouse.click(6,6);
   await settle(s.page);await expect.poll(()=>reopened.image.isVisible(),{timeout:1500}).toBe(false);
   expect(JSON.stringify(await workflow(s)),'all preview operations leave source workflow untouched').toBe(before);
   expect(s.downloadReads).toBe(3);
   expect(s.counts.has('POST /api/workflow/execute')||s.counts.has('POST /api/skill-runs')||s.counts.has('POST /api/assets'),'no execution model or asset write').toBe(false);
   console.log('HS_PREVIEW_FLOW',JSON.stringify({theme,width,height,held:true,duplicateBlocked:true,firstDownloadBytes:true,errorFallback:true,retryBytes:true,close:true,reopen:true,backdropClose:true,graphUnchanged:true,imageReads:s.imageReads,downloadReads:s.downloadReads}));
   // Kept at end so a small target does not hide actual download/close behavior.
   expect(controls[0].rect!.width,'download target width').toBeGreaterThanOrEqual(44);
   expect(controls[0].rect!.height,'download target height').toBeGreaterThanOrEqual(44);
   expect(controls[1].rect!.width,'close target width').toBeGreaterThanOrEqual(44);
   expect(controls[1].rect!.height,'close target height').toBeGreaterThanOrEqual(44);
   expect(controls.every(c=>c.area.visible&&c.area.hit),'both complete actions are visible and hit-tested').toBe(true);
  });
 },25000);
});









// These checks use the same isolated browser, request boundary and teardown as
// the preview/download cases, but deliberately perform no downloads.
async function withPointerPreviewSession(theme: Theme, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, 1040, 720, { preview: true, nodeType: 'input-image' });
  const verifyRequests = (): void => {
    expect([...s.counts.keys()].sort()).toEqual(['GET /', 'GET /api/skills?surface=workflow', 'GET /test-media/source.png'].sort());
    expect(s.imageReads).toBeGreaterThanOrEqual(1);
    expect(s.counts.get('GET /test-media/source.png')).toBe(s.imageReads);
    expect(s.downloadReads).toBe(0);
    expect(s.counts.has('POST /api/save-image')).toBe(false);
  };
  let failed = false, primary: unknown, cleanup: unknown;
  try { await run(s); await nativeFinished(s); verifyRequests(); } catch (error) { failed = true; primary = error; }
  try { await dispose(s, undefined, undefined, true); if (!failed) verifyRequests(); } catch (error) { cleanup = error; }
  if (failed && cleanup) throw new AggregateError([primary, cleanup], 'PREVIEW_POINTER_TEST_AND_CLEANUP');
  if (failed) throw primary;
  if (cleanup) throw cleanup;
}

async function pointerPreviewThumb(s: Session): Promise<Locator> {
  const library = toolbar(s).getByRole('button', { name: '切换节点库面板', exact: true });
  if (await library.getAttribute('aria-pressed') === 'true') { await reveal(s, toolbar(s), library, true); await activate(s, library); }
  const thumb = s.page.locator('[data-node-id] img[src="' + ORIGIN + '/test-media/source.png"]');
  await thumb.waitFor();
  return thumb;
}

async function clickPointerPreview(s: Session, thumb: Locator): Promise<void> {
  await thumb.locator('..').click(); await settle(s.page);
  const close = s.page.getByRole('button', { name: '关闭预览', exact: true });
  await close.waitFor(); expect(await close.count()).toBe(1);
  await close.click(); await settle(s.page);
}

async function assertNoPreviewForChord(s: Session, thumb: Locator, rightFirst: boolean): Promise<void> {
  const rect = await thumb.boundingBox(); if (!rect) throw Error('PREVIEW_THUMB_BOUNDS');
  await s.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await s.page.mouse.down({ button: 'left' }); await s.page.mouse.down({ button: 'right' });
  if (rightFirst) {
    await s.page.mouse.up({ button: 'right' }); await s.page.keyboard.press('Escape'); await settle(s.page);
    await s.page.mouse.up({ button: 'left' });
  } else {
    await s.page.mouse.up({ button: 'left' }); await s.page.mouse.up({ button: 'right' });
    await s.page.keyboard.press('Escape');
  }
  await settle(s.page);
  expect(await s.page.getByRole('button', { name: '关闭预览', exact: true }).count(), 'mixed mouse buttons must not open preview').toBe(0);
}

describe('desktop input-image pointer preview', () => {
  it.each(THEMES)('%s: real click, node drag, both chord releases and cancel recovery', async theme => {
    await withPointerPreviewSession(theme, async s => {
      const thumb = await pointerPreviewThumb(s);
      await clickPointerPreview(s, thumb);
      const before = await workflow(s), id = await thumb.locator('xpath=ancestor::*[@data-node-id][1]').getAttribute('data-node-id');
      const node = before.nodes.find(item => item.id === id); if (!node) throw Error('PREVIEW_NODE_MISSING');
      const rect = await thumb.boundingBox(); if (!rect) throw Error('PREVIEW_THUMB_BOUNDS');
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      await s.page.mouse.move(x, y); await s.page.mouse.down(); await s.page.mouse.move(x + 40, y + 25, { steps: 5 }); await s.page.mouse.up(); await settle(s.page);
      const moved = (await workflow(s)).nodes.find(item => item.id === id); if (!moved) throw Error('PREVIEW_NODE_MISSING_AFTER_DRAG');
      expect(Math.hypot(moved.x - node.x, moved.y - node.y), 'mouse drag moves the node').toBeGreaterThan(10);
      expect(await s.page.getByRole('button', { name: '关闭预览', exact: true }).count(), 'drag must not open preview').toBe(0);
      await assertNoPreviewForChord(s, thumb, false); await assertNoPreviewForChord(s, thumb, true);
      const next = await thumb.boundingBox(); if (!next) throw Error('PREVIEW_THUMB_BOUNDS');
      await s.page.mouse.move(next.x + next.width / 2, next.y + next.height / 2); await s.page.mouse.down();
      await s.page.evaluate(() => window.dispatchEvent(new Event('blur'))); await s.page.mouse.up(); await settle(s.page);
      expect(await s.page.getByRole('button', { name: '关闭预览', exact: true }).count(), 'cancel must not open preview').toBe(0);
      await clickPointerPreview(s, thumb);
    });
  }, 25000);

  it.each(THEMES)('%s: capture failure preserves normal clicks but rejects both chords', async theme => {
    await withPointerPreviewSession(theme, async s => {
      const thumb = await pointerPreviewThumb(s);
      await s.page.evaluate(() => {
        const state = window as Window & { savedPreviewCapture?: typeof Element.prototype.setPointerCapture };
        state.savedPreviewCapture = Element.prototype.setPointerCapture;
        Element.prototype.setPointerCapture = function (id: number): void {
          if (this.hasAttribute('data-node-id')) throw new DOMException('capture refused', 'NotFoundError');
          state.savedPreviewCapture!.call(this, id);
        };
      });
      try {
        await clickPointerPreview(s, thumb);
        await assertNoPreviewForChord(s, thumb, false); await assertNoPreviewForChord(s, thumb, true);
        await clickPointerPreview(s, thumb);
      } finally {
        await s.page.evaluate(() => {
          const state = window as Window & { savedPreviewCapture?: typeof Element.prototype.setPointerCapture };
          if (!state.savedPreviewCapture) throw Error('PREVIEW_CAPTURE_RESTORE_MISSING');
          Element.prototype.setPointerCapture = state.savedPreviewCapture; delete state.savedPreviewCapture;
        });
      }
    });
  }, 25000);
});
