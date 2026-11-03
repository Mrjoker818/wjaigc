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
interface Options { preview?: boolean; asset?: 'allow' | 'deny' | 'scope' | 'hold'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean; emptyGraph?: boolean }
interface FixtureWindow extends Window { nodeProperty: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null; imageReads: number; downloadReads: number; releasePreview: () => void; releaseAsset: () => void }
const ORIGIN = 'https://node-secondary-hw-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import NodeEditor from '@/components/node-editor';
import {createEmptyWorkflow,createWorkflowNode,createConnection,type Workflow,type NodeType} from '@/lib/workflow-engine';
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
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{preview?:boolean;asset?:string;nodeType?:NodeType;config?:Record<string,unknown>;modelFixtures?:boolean;emptyGraph?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)throw Error('NODE_PROPERTY_FIXTURE_CANVAS');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,48,48);const url=canvas.toDataURL();
 const workflow={...createEmptyWorkflow('离线目录验收工作流'),id:'ui-node-workflow'};
 const node=createWorkflowNode(options.nodeType||'input-param',40,60,'离线属性节点');node.id='hw-result';node.type='input-image';node.x=20;node.y=10;node.config={...node.config,imageUrl:url,source:'url'};
 const source=createWorkflowNode('input-image',-500,-500,'离线原图节点');source.id='hw-source';ctx.fillStyle='#d4af37';ctx.fillRect(0,0,48,48);source.config={...source.config,imageUrl:canvas.toDataURL(),source:'url'};workflow.nodes=[source,node];workflow.connections=[createConnection(source.id,'out-image',node.id,'in-image','image')];
 if(options.emptyGraph){workflow.nodes=[];workflow.connections=[];}
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
  if (!browser) throw Error('NODE_PROPERTY_FIXTURE_BROWSER_REQUIRED'); const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: width < 1000, isMobile: width < 1000 }); contexts.add(context); let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), waiters: new Set(), mounted: false, canonicalUrl: null, imageReads: 0, downloadReads: 0, releasePreview: () => undefined, releaseAsset: () => undefined }; value = s; live.add(s);
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
        if (key === 'POST /api/assets' && ['allow', 'deny', 'hold'].includes(options.asset ?? '')) {
          if (headers['content-type'] !== 'application/json' || headers['x-wujie-expected-actor-id'] !== 'ui-node-actor' || request.postData() !== JSON.stringify({ projectId: 'ui-node-project', assetVersionId: 'ui-source-version', placementId: 'ui-source-placement' })) throw Error('NODE_PROPERTY_FIXTURE_ASSET_IDENTITY');
          if (options.asset === 'deny') { await route.fulfill({ status: 403, json: { code: 'DOCUMENT_FORBIDDEN' } }); return; }
          if (options.asset === 'hold') await new Promise<void>(resolve => { s.releaseAsset = resolve; });
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
  const failures: unknown[] = []; s.releasePreview();s.releaseAsset();
  try { if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).nodeProperty.unmount())); cleanupProbe?.(); } catch (e) { failures.push(e); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); await nativeFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (e) { failures.push(e); }
  const pending = s.pending.size !== 0 || s.handlers.size !== 0; try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (e) { failures.push(e); }
  const invalid = (code: string): never => { if (failures.length) throw new AggregateError([Error(code), ...failures], 'NODE_PROPERTY_FIXTURE_VALIDATION_AND_CLEANUP'); throw Error(code); };
  const partialPreview = primaryFailure && s.options.preview === true;
  const expected = ['GET /', 'GET /api/skills?surface=workflow']; if (['allow', 'deny', 'hold'].includes(s.options.asset ?? '')) expected.push('POST /api/assets'); if (refusal === 'http') expected.push('GET /unexpected'); if(s.options.preview){if(!partialPreview||s.counts.has('GET /test-media/source.png'))expected.push('GET /test-media/source.png');if(!partialPreview||s.counts.has('POST /api/save-image'))expected.push('POST /api/save-image');}
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
  try { await dispose(s,undefined,undefined,primary!==undefined); } catch (cleanup) { if (primary) { console.error('FIXTURE_PRIMARY',primary,'FIXTURE_CLEANUP',cleanup); throw new AggregateError([primary, cleanup], 'NODE_PROPERTY_FIXTURE_TEST_AND_CLEANUP'); } throw cleanup; } if (primary) throw primary;
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
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/playwright/node-minimap-hy-r4-20261020',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_PROPERTY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }

function properties(s:Session):Locator{return s.page.getByText('节点属性',{exact:true}).locator('../..');}
function propertyScroll(s:Session):Locator{return properties(s).locator(':scope > div').last();}
async function selectNode(s:Session):Promise<Locator>{const entry=s.page.getByRole('button',{name:'切换节点库面板',exact:true});if(await entry.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),entry,true);await entry.click();await settle(s.page);}const card=s.page.locator('[data-node-id][aria-label="离线属性节点"]');await card.waitFor();await card.click({position:{x:15,y:15}});await settle(s.page);await properties(s).getByRole('button',{name:'关闭节点属性',exact:true}).waitFor();return properties(s);}
async function propertyTarget(s:Session,control:Locator):Promise<void>{await reveal(s,propertyScroll(s),control);await target(control);}
async function inputSize(control:Locator):Promise<void>{expect(await control.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize)),'property input text size').toBeGreaterThanOrEqual(16);}



const CASES=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1040,720]].map(([width,height])=>({theme,width,height})));
async function activateHw(s:Session,e:Locator):Promise<void>{
 if(s.page.viewportSize()!.width<1000)await e.tap();else await e.click();await settle(s.page);
}
async function geometryHw(e:Locator):Promise<Record<string,unknown>|null>{
 if(await e.count()!==1)return null;
 return e.evaluate(node=>{
  const r=node.getBoundingClientRect(),style=getComputedStyle(node);
  const visible=style.display!=='none'&&style.visibility!=='hidden'&&r.width>0&&r.height>0;
  let clear=visible&&r.left>=0&&r.top>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5;
  for(let p=node.parentElement;p;p=p.parentElement){
   const q=p.getBoundingClientRect(),c=getComputedStyle(p);
   if(/(auto|scroll|hidden|clip)/.test(c.overflowX)&&(r.left<q.left+p.clientLeft-.5||r.right>q.left+p.clientLeft+p.clientWidth+.5))clear=false;
   if(/(auto|scroll|hidden|clip)/.test(c.overflowY)&&(r.top<q.top+p.clientTop-.5||r.bottom>q.top+p.clientTop+p.clientHeight+.5))clear=false;
  }
  const points=[[r.left+r.width/2,r.top+r.height/2],[r.left+Math.min(8,r.width/4),r.top+r.height/2],[r.right-Math.min(8,r.width/4),r.top+r.height/2],[r.left+r.width/2,r.top+Math.min(8,r.height/4)],[r.left+r.width/2,r.bottom-Math.min(8,r.height/4)]];
  return{x:r.x,y:r.y,width:r.width,height:r.height,visible,clear,hit:visible&&points.every(([x,y])=>node.contains(document.elementFromPoint(x,y))),fontSize:parseFloat(style.fontSize)};
 });
}
async function swipeHw(s:Session,from:{x:number;y:number},to:{x:number;y:number},cancel=false):Promise<void>{
 const cdp=await s.context.newCDPSession(s.page);let active=false,primary:unknown;const cleanup:unknown[]=[];
 try{
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});active=true;
  for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/5,y:from.y+(to.y-from.y)*i/5,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});active=false;
 }catch(error){primary=error;}
 if(active){try{await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch(error){cleanup.push(error);}}
 try{await cdp.detach();}catch(error){cleanup.push(error);}
 if(primary!==undefined){if(cleanup.length)throw new AggregateError([primary,...cleanup],'HW_TOUCH_AND_CLEANUP');throw primary;}
 if(cleanup.length)throw new AggregateError(cleanup,'HW_TOUCH_CLEANUP');
 await settle(s.page);
}
async function centerHitHw(control:Locator):Promise<boolean>{return control.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y));});}
async function clearPropertyHw(s:Session):Promise<boolean>{const button=s.page.getByRole('button',{name:'关闭节点属性',exact:true});if(await button.isVisible()){await activateHw(s,button);return true;}return false;}
async function closeBackdropHw(s:Session):Promise<void>{if(s.page.viewportSize()!.width<1000)await s.page.touchscreen.tap(4,4);else await s.page.mouse.click(4,4);await settle(s.page);}


async function activateHy(s:Session,e:Locator):Promise<void>{
 const touch=await s.page.evaluate(()=>navigator.maxTouchPoints>0);
 if(touch)await e.tap();else await e.click();await settle(s.page);
}
async function hyCloseDirectory(s:Session):Promise<void>{
 const library=toolbar(s).getByRole('button',{name:'切换节点库面板',exact:true});
 if(await library.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),library,true);await activateHy(s,library);}
}
interface HyIndicator { canvas:{x:number;y:number;width:number;height:number}; zoom:number; panX:number; panY:number; marker:{x:number;y:number;width:number;height:number} }
async function hyIndicator(s:Session):Promise<HyIndicator>{
 const r=await s.page.evaluate(()=>{
  const canvas=document.querySelector('.canvas-bg')?.getBoundingClientRect();
  const layer=document.querySelector('[data-workflow-legacy-node-layer]') as HTMLElement|null;
  const marker=document.querySelector('[data-workflow-minimap-viewport]') as SVGRectElement|null;
  const v=layer?new DOMMatrix(getComputedStyle(layer).transform):null;
  if(!canvas||!v||!marker)throw Error('HY_REAL_INDICATOR_INPUTS');
  return {canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},zoom:v.a,panX:v.e,panY:v.f,
   marker:{x:marker.x.baseVal.value,y:marker.y.baseVal.value,width:marker.width.baseVal.value,height:marker.height.baseVal.value}};
 });
 expect(r.zoom).toBeGreaterThan(0);
 expect(Math.abs(r.marker.x*r.zoom+r.panX),'indicator world left tracks rendered pan').toBeLessThan(1);
 expect(Math.abs(r.marker.y*r.zoom+r.panY),'indicator world top tracks rendered pan').toBeLessThan(1);
 expect(Math.abs(r.marker.width*r.zoom-r.canvas.width),'indicator uses actual canvas width').toBeLessThan(1);
 expect(Math.abs(r.marker.height*r.zoom-r.canvas.height),'indicator uses actual canvas height').toBeLessThan(1);
 return r;
}
async function hyLegend(s:Session):Promise<unknown>{
 const legend=s.page.locator('[data-workflow-port-legend]'),map=s.page.locator('[data-workflow-minimap]');
 const toggle=legend.getByRole('button',{name:'端口图例',exact:true});
 if(await toggle.isVisible()){await target(toggle);if(await toggle.getAttribute('aria-expanded')==='false')await activateHy(s,toggle);expect(await toggle.getAttribute('aria-expanded')).toBe('true');}
 const a=await legend.boundingBox(),b=await map.boundingBox();if(!a||!b)throw Error('HY_LEGEND_MAP_RECTS');
 expect(a.x+a.width<=b.x+.5||b.x+b.width<=a.x+.5||a.y+a.height<=b.y+.5||b.y+b.height<=a.y+.5,'legend and minimap do not overlap').toBe(true);
 expect((await geometryHw(legend))?.clear,'legend scroll region fits').toBe(true);
 const entries=legend.locator('[data-workflow-port-type]'),count=await entries.count();expect(count).toBeGreaterThan(0);
 const items=legend.locator('[data-workflow-port-legend-items]');const scroller=await toggle.isVisible()?items:legend;
 for(let i=0;i<count;i++){const e=entries.nth(i);await reveal(s,scroller,e);expect((await geometryHw(e))?.clear,'each legend entry reachable without clipping').toBe(true);expect(await e.evaluate(n=>getComputedStyle(n).whiteSpace),'port labels do not break into vertical characters').toBe('nowrap');}
 return {legend:a,map:b,readableEntries:count};
}
async function hyReopen(s:Session):Promise<Locator>{
 const toggle=toolbar(s).getByRole('button',{name:'切换小地图',exact:true});await reveal(s,toolbar(s),toggle,true);await target(toggle);
 expect(await toggle.getAttribute('aria-pressed')).toBe('false');await activateHy(s,toggle);
 expect(await toggle.getAttribute('aria-pressed')).toBe('true');
 const nav=s.page.getByRole('button',{name:'小地图导航',exact:true});await target(nav);return nav;
}
async function hyAlignResponsiveMinimap(s:Session, expectedOpen:boolean):Promise<void>{
 const toggle=toolbar(s).getByRole('button',{name:'切换小地图',exact:true});
 expect(await toggle.getAttribute('aria-pressed'),'minimap visibility matches the responsive phase').toBe(expectedOpen?'true':'false');
 if(!expectedOpen)await hyReopen(s);
 else await target(s.page.getByRole('button',{name:'小地图导航',exact:true}));
}
async function hyKeyboard(s:Session,nav:Locator):Promise<void>{
 const before=await s.page.locator('[data-workflow-legacy-edge-layer] > g').getAttribute('transform');
 await nav.focus();expect(await nav.evaluate(e=>document.activeElement===e)).toBe(true);
 const box=await nav.boundingBox();if(!box)throw Error('HY_KEYBOARD_NAV_RECT');
 await s.page.keyboard.press('ArrowRight');await settle(s.page);
 const focus=await nav.evaluate(e=>({active:document.activeElement===e,visible:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineStyle,shadow:getComputedStyle(e).boxShadow}));expect(focus.active&&focus.visible&&(focus.outline!=='none'||focus.shadow!=='none'),'native keyboard focus is actually visible').toBe(true);
 const delta=await s.page.locator('[data-workflow-legacy-edge-layer] > g').evaluate((el,prior)=>{
  const values=(v:string|null)=>{const m=v?.match(/translate\(([-\d.]+), ([-\d.]+)\)/);if(!m)throw Error('HY_RENDERED_TRANSLATE');return[Number(m[1]),Number(m[2])];};
  const a=values(prior),b=values(el.getAttribute('transform'));return {x:b[0]-a[0],y:b[1]-a[1]};
 },before);
 expect(delta.x,'Right key moves visible canvas right by 40 screen pixels').toBeCloseTo(-40,6);expect(delta.y).toBe(0);
 await s.page.keyboard.press('Enter');await settle(s.page);const centered=await hyIndicator(s),expected=s.options.emptyGraph?{x:600,y:400}:{x:350,y:150};
 const actual={x:(centered.canvas.width/2-centered.panX)/centered.zoom,y:(centered.canvas.height/2-centered.panY)/centered.zoom};
 expect(actual.x,'Enter centers real canvas on hand-derived full graph X').toBeCloseTo(expected.x,6);
 expect(actual.y,'Enter centers real canvas on hand-derived full graph Y').toBeCloseTo(expected.y,6);
 console.log('HY_MINIMAP_KEYBOARD',JSON.stringify({empty:s.options.emptyGraph===true,delta,actual,expected,enterCentered:true}));
}
describe('material drop geometry and history',()=>{
 it.each(THEMES)('320 square expanded material supports touch drag to the canvas in $theme',async theme=>{
  await withSession(theme,320,320,{nodeType:'input-image',asset:'allow'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);
   const expand=s.page.getByRole('button',{name:'展开内容素材',exact:true});await target(expand);await activateHy(s,expand);
   const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();await target(drag);
   const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   const drop={x:280,y:100};const surface=s.page.locator('[data-workflow-legacy-surface]');
   const hit=await surface.evaluate((e,point)=>e.contains(document.elementFromPoint(point.x,point.y)),drop);expect(hit).toBe(true);
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},drop);
   await expect.poll(async()=> (await workflow(s)).nodes.length,{timeout:5000}).toBe(before.nodes.length+1);
   await expect.poll(async()=> (await workflow(s)).nodes.find(node=>!before.nodes.some(old=>old.id===node.id))?.config.assetTransferPending,{timeout:5000}).toBe(false);
   const after=await workflow(s),added=after.nodes.filter(node=>!before.nodes.some(old=>old.id===node.id));expect(added).toHaveLength(1);
   expect(added[0].config.assetVersionId).toBe('ui-source-version');expect(added[0].config.placementId).toBe('ui-source-placement');expect(added[0].config.imageUrl).toBe(s.canonicalUrl);
   const bounds=await s.page.locator('[data-node-id=\"'+added[0].id+'\"]').boundingBox();if(!bounds)throw Error('INSERTED_NODE_BOUNDS');
   expect(Math.abs(bounds.x+bounds.width/2-drop.x)).toBeLessThanOrEqual(2);expect(Math.abs(bounds.y+bounds.height/2-drop.y)).toBeLessThanOrEqual(2);
   expect(after.connections).toEqual(before.connections);expect(after.nodes.filter(node=>before.nodes.some(old=>old.id===node.id))).toEqual(before.nodes);expect(s.counts.get('POST /api/assets')).toBe(1);
  });
 },25000);
 it.each(THEMES)('touch insertion stays centered through one undo and redo in $theme',async theme=>{
  await withSession(theme,320,320,{nodeType:'input-image',asset:'allow'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);
   await activateHy(s,s.page.getByRole('button',{name:'展开内容素材',exact:true}));
   const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   const drop={x:280,y:100};await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},drop);
   await expect.poll(async()=> (await workflow(s)).nodes.find(node=>!before.nodes.some(old=>old.id===node.id))?.config.assetTransferPending,{timeout:5000}).toBe(false);
   const added=(await workflow(s)).nodes.find(node=>!before.nodes.some(old=>old.id===node.id))!;
   const center=async()=>{const bounds=await s.page.locator('[data-node-id="'+added.id+'"]').boundingBox();if(!bounds)throw Error('INSERTED_NODE_BOUNDS');return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}};
   await expect.poll(async()=>{const point=await center();return Math.hypot(point.x-drop.x,point.y-drop.y)},{timeout:5000}).toBeLessThanOrEqual(2);
   await undo(s);expect((await workflow(s)).nodes.some(node=>node.id===added.id)).toBe(false);
   const redo=s.page.getByRole('button',{name:'重做',exact:true});await reveal(s,toolbar(s),redo,true);await redo.click();await settle(s.page);
   await expect.poll(async()=>{const point=await center();return Math.hypot(point.x-drop.x,point.y-drop.y)},{timeout:5000}).toBeLessThanOrEqual(2);
   const after=await workflow(s);expect(after.nodes.filter(node=>before.nodes.some(old=>old.id===node.id))).toEqual(before.nodes);expect(s.counts.get('POST /api/assets')).toBe(1);
   await undo(s);expect((await workflow(s)).nodes.some(node=>node.id===added.id)).toBe(false);
  });
 },25000);
 it('does not recenter a node manually moved while its asset reply is pending',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image',asset:'hold'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);
   const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   const drop={x:330,y:320};await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},drop);
   await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id));if(!node)throw Error('INSERTED_NODE_MISSING');
   const closeProperties=s.page.getByRole('button',{name:'关闭节点属性',exact:true});await closeProperties.waitFor({state:'visible'});await closeProperties.click();await expect.poll(()=>closeProperties.isVisible()).toBe(false);
   const handle=s.page.locator('[data-node-id="'+node.id+'"] [data-workflow-node-drag-handle]').first();const bounds=await handle.boundingBox();if(!bounds)throw Error('NODE_HANDLE_BOUNDS');
   const from={x:Math.min(380,Math.max(10,bounds.x+25)),y:bounds.y+bounds.height/2};
   console.log('DRAG_HANDLE_DIAG',JSON.stringify({bounds,from,hit:await s.page.evaluate(point=>{let e=document.elementFromPoint(point.x,point.y);const chain=[];while(e&&chain.length<7){chain.push(e.tagName+':'+e.className+':'+e.getAttribute('aria-label'));e=e.parentElement}return chain},from)}));
   expect(await handle.evaluate((element,point)=>element.contains(document.elementFromPoint(point.x,point.y)),from),'drag handle hit').toBe(true);
   await s.page.mouse.move(from.x,from.y);await s.page.mouse.down();await s.page.mouse.move(from.x-40,from.y+60,{steps:5});await s.page.mouse.up();await settle(s.page);
   const moved=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(Math.abs(moved.x-node.x)+Math.abs(moved.y-node.y)).toBeGreaterThan(2);
   s.releaseAsset();await expect.poll(async()=> (await workflow(s)).nodes.find(item=>item.id===node.id)?.config.assetTransferPending,{timeout:5000}).toBe(false);
   const final=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(final.x).toBeCloseTo(moved.x,3);expect(final.y).toBeCloseTo(moved.y,3);
   await undo(s);expect((await workflow(s)).nodes.some(item=>item.id===node.id)).toBe(true);
   await undo(s);expect((await workflow(s)).nodes.some(item=>item.id===node.id)).toBe(false);
   const redo=s.page.getByRole('button',{name:'重做',exact:true});await reveal(s,toolbar(s),redo,true);await redo.click();await settle(s.page);await redo.click();await settle(s.page);
   const restored=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(restored.x).toBeCloseTo(moved.x,3);expect(restored.y).toBeCloseTo(moved.y,3);
  });
 },25000);
 it('keeps the logical drop center when zoom changes before the asset reply',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image',asset:'hold'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   const drop={x:330,y:320};const transform=()=>s.page.evaluate(()=>{const surface=document.querySelector('[data-workflow-legacy-surface]')!.getBoundingClientRect();const layer=document.querySelector('[data-workflow-legacy-node-layer]')!;const m=new DOMMatrix(getComputedStyle(layer).transform);return {left:surface.left,top:surface.top,scale:m.a,x:m.e,y:m.f}});
   const initial=await transform();const world={x:(drop.x-initial.left-initial.x)/initial.scale,y:(drop.y-initial.top-initial.y)/initial.scale};
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},drop);await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   const close=s.page.getByRole('button',{name:'关闭节点属性',exact:true});await close.waitFor({state:'visible'});await close.click();await expect.poll(()=>close.isVisible()).toBe(false);
   await s.page.mouse.move(15,500);await s.page.mouse.wheel(0,-200);await settle(s.page);const zoomed=await transform();expect(zoomed.scale).not.toBe(initial.scale);
   s.releaseAsset();await expect.poll(async()=> (await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id))?.config.assetTransferPending,{timeout:5000}).toBe(false);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id))!;const expected={x:zoomed.left+zoomed.x+world.x*zoomed.scale,y:zoomed.top+zoomed.y+world.y*zoomed.scale};
   await expect.poll(async()=>{const box=await s.page.locator('[data-node-id="'+node.id+'"]').boundingBox();return box?Math.hypot(box.x+box.width/2-expected.x,box.y+box.height/2-expected.y):Infinity},{timeout:5000}).toBeLessThanOrEqual(2);
  });
 },25000);
 it('does not resurrect an undone node when the asset reply arrives late',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image',asset:'hold'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:330,y:320});await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id));if(!node)throw Error('INSERTED_NODE_MISSING');
   await undo(s);expect((await workflow(s)).nodes.some(item=>item.id===node.id)).toBe(false);
   s.releaseAsset();await nativeFinished(s);await settle(s.page);expect((await workflow(s)).nodes.some(item=>item.id===node.id)).toBe(false);
   const redo=s.page.getByRole('button',{name:'重做',exact:true});await reveal(s,toolbar(s),redo,true);await redo.click();await settle(s.page);
   expect((await workflow(s)).nodes.some(item=>item.id===node.id)).toBe(true);
   await expect.poll(async()=>{const box=await s.page.locator('[data-node-id="'+node.id+'"]').boundingBox();return box?Math.hypot(box.x+box.width/2-330,box.y+box.height/2-320):Infinity},{timeout:5000}).toBeLessThanOrEqual(2);
   await undo(s);expect((await workflow(s)).nodes.some(item=>item.id===node.id)).toBe(false);
  });
 },25000);
 it('does not auto-center after a user moves the pending node away and back',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image',asset:'hold'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:330,y:320});await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id));if(!node)throw Error('INSERTED_NODE_MISSING');
   const close=s.page.getByRole('button',{name:'关闭节点属性',exact:true});await close.waitFor({state:'visible'});await close.click();await expect.poll(()=>close.isVisible()).toBe(false);
   const handle=s.page.locator('[data-node-id="'+node.id+'"] [data-workflow-node-drag-handle]').first();const box=await handle.boundingBox();if(!box)throw Error('NODE_HANDLE_BOUNDS');const start={x:box.x+25,y:box.y+box.height/2};
   expect(await handle.evaluate((element,point)=>element.contains(document.elementFromPoint(point.x,point.y)),start)).toBe(true);
   await s.page.mouse.move(start.x,start.y);await s.page.mouse.down();await s.page.mouse.move(start.x-40,start.y+55,{steps:3});await s.page.mouse.move(start.x,start.y,{steps:3});await s.page.mouse.up();await settle(s.page);
   const returned=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(returned.x).toBeCloseTo(node.x,2);expect(returned.y).toBeCloseTo(node.y,2);
   s.releaseAsset();await expect.poll(async()=> (await workflow(s)).nodes.find(item=>item.id===node.id)?.config.assetTransferPending,{timeout:5000}).toBe(false);await settle(s.page);
   const final=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(final.x).toBeCloseTo(returned.x,2);expect(final.y).toBeCloseTo(returned.y,2);
  });
 },25000);
 it('preserves a same-frame away-and-back manual move before the reply',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image',asset:'hold'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:330,y:320});await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id));if(!node)throw Error('INSERTED_NODE_MISSING');
   const close=s.page.getByRole('button',{name:'关闭节点属性',exact:true});await close.waitFor({state:'visible'});await close.click();await expect.poll(()=>close.isVisible()).toBe(false);
   const handle=s.page.locator('[data-node-id="'+node.id+'"] [data-workflow-node-drag-handle]').first();const box=await handle.boundingBox();if(!box)throw Error('NODE_HANDLE_BOUNDS');const start={x:box.x+25,y:box.y+box.height/2};
   expect(await handle.evaluate((element,point)=>element.contains(document.elementFromPoint(point.x,point.y)),start)).toBe(true);
   await handle.evaluate((element,point)=>{const surface=element.closest('[data-workflow-legacy-surface]')!;element.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:point.x,clientY:point.y}));surface.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:point.x-40,clientY:point.y+55}));surface.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:point.x,clientY:point.y}));surface.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:point.x,clientY:point.y}));},start);
   await settle(s.page);const returned=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(returned.x).toBeCloseTo(node.x,2);expect(returned.y).toBeCloseTo(node.y,2);
   s.releaseAsset();await expect.poll(async()=> (await workflow(s)).nodes.find(item=>item.id===node.id)?.config.assetTransferPending,{timeout:5000}).toBe(false);await settle(s.page);
   const final=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(final.x).toBeCloseTo(returned.x,2);expect(final.y).toBeCloseTo(returned.y,2);
  });
 },25000);
 it('preserves a one-pixel user width edit while the asset reply is pending',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image',asset:'hold'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:330,y:320});await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id));if(!node)throw Error('INSERTED_NODE_MISSING');
   const jsonButton=s.page.locator('button[title="查看/编辑JSON"]');await reveal(s,toolbar(s),jsonButton,true);await jsonButton.click();
   const editor=s.page.getByRole('textbox',{name:'工作流 JSON 内容'});const value=JSON.parse(await editor.inputValue()) as { nodes: Array<{ id: string; width: number }> };const editable=value.nodes.find(entry=>entry.id===node.id);if(!editable)throw Error('EDITABLE_NODE_MISSING');editable.width=node.width+1;await editor.fill(JSON.stringify(value));await s.page.getByRole('button',{name:'应用更改',exact:true}).click();
   await expect.poll(async()=> (await workflow(s)).nodes.find(item=>item.id===node.id)?.width,{timeout:5000}).toBeCloseTo(node.width+1,2);
   const edited=(await workflow(s)).nodes.find(item=>item.id===node.id)!;s.releaseAsset();await expect.poll(async()=> (await workflow(s)).nodes.find(item=>item.id===node.id)?.config.assetTransferPending,{timeout:5000}).toBe(false);await settle(s.page);
   const final=(await workflow(s)).nodes.find(item=>item.id===node.id)!;expect(final.x).toBeCloseTo(edited.x,2);expect(final.y).toBeCloseTo(edited.y,2);expect(final.width).toBeCloseTo(edited.width,2);
  });
 },25000);
 it('keeps the denied asset non-runnable after touch insertion',async()=>{
  await withSession('gold',320,320,{nodeType:'input-image',asset:'deny'},async s=>{
   await hyCloseDirectory(s);const before=await workflow(s);await activateHy(s,s.page.getByRole('button',{name:'展开内容素材',exact:true}));
   const drag=s.page.getByRole('button',{name:'拖动素材 离线规范素材 到画布',exact:true});await drag.scrollIntoViewIfNeeded();const rect=await drag.boundingBox();if(!rect)throw Error('MATERIAL_DRAG_BOUNDS');
   await swipeHw(s,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:280,y:100});await expect.poll(()=>s.counts.get('POST /api/assets'),{timeout:5000}).toBe(1);
   await expect.poll(async()=> (await workflow(s)).nodes.find(node=>!before.nodes.some(old=>old.id===node.id))?.config.assetTransferPending,{timeout:5000}).toBe(false);
   const node=(await workflow(s)).nodes.find(item=>!before.nodes.some(old=>old.id===item.id))!;
   expect(node.config.imageUrl).toBe('');expect(node.config.assetVersionId).toBeUndefined();expect(node.config.placementId).toBeUndefined();
  });
 },25000);
});
