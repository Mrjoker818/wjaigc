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
interface Options { preview?: boolean; asset?: 'allow' | 'deny' | 'scope'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean; emptyGraph?: boolean; firstUpstreamEmpty?: boolean }
interface FixtureWindow extends Window { nodeProperty: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null; imageReads: number; downloadReads: number; releasePreview: () => void }
const ORIGIN = 'https://node-secondary-hw-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import NodeEditor from '@/components/node-editor';
import {createEmptyWorkflow,createWorkflowNode,createConnection,canConnectPorts,type Workflow,type NodeType} from '@/lib/workflow-engine';
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
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{preview?:boolean;asset?:string;nodeType?:NodeType;config?:Record<string,unknown>;modelFixtures?:boolean;emptyGraph?:boolean;firstUpstreamEmpty?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)throw Error('NODE_PROPERTY_FIXTURE_CANVAS');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,48,48);const url=canvas.toDataURL();
 const workflow={...createEmptyWorkflow('离线目录验收工作流'),id:'ui-node-workflow'};
 const node=createWorkflowNode(options.nodeType||'input-param',40,60,'离线属性节点');node.id='hw-result';node.type='output-image';node.x=20;node.y=10;node.config={...node.config,imageUrl:url,source:'url'};
 const source=createWorkflowNode('input-image',-500,-500,'离线原图节点');source.id='hw-source';ctx.fillStyle='#d4af37';ctx.fillRect(0,0,48,48);source.config={...source.config,imageUrl:canvas.toDataURL(),source:'url'};workflow.nodes=[source,node];workflow.connections=[createConnection(source.id,'out-image',node.id,'in-image','image')];
 const out=source.ports.find(p=>p.id==='out-image'&&p.direction==='out'),input=node.ports.find(p=>p.id==='in-image'&&p.direction==='in');
 if(node.type!=='output-image'||source.type!=='input-image'||!out||!input||!canConnectPorts(out.type,input.type))throw Error('IC_VALID_INPUT_OUTPUT_PORTS_REQUIRED');
 if(options.firstUpstreamEmpty){
  const empty=createWorkflowNode('input-image',-800,-500,'离线无图首源');empty.id='hw-empty-source';
  const emptyOut=empty.ports.find(p=>p.id==='out-image'&&p.direction==='out');
  if(empty.config.imageUrl||!emptyOut||!canConnectPorts(emptyOut.type,input.type))throw Error('ID_VALID_EMPTY_FIRST_SOURCE_REQUIRED');
  workflow.nodes=[empty,source,node];workflow.connections=[createConnection(empty.id,'out-image',node.id,'in-image','image'),...workflow.connections];
 }
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
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/playwright/node-compare-id-20261021',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_PROPERTY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }

function properties(s:Session):Locator{return s.page.getByText('节点属性',{exact:true}).locator('../..');}
function propertyScroll(s:Session):Locator{return properties(s).locator(':scope > div').last();}
async function selectNode(s:Session):Promise<Locator>{const entry=s.page.getByRole('button',{name:'切换节点库面板',exact:true});if(await entry.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),entry,true);await entry.click();await settle(s.page);}const card=s.page.locator('[data-node-id][aria-label="离线属性节点"]');await card.waitFor();await card.click({position:{x:15,y:15}});await settle(s.page);await properties(s).getByRole('button',{name:'关闭节点属性',exact:true}).waitFor();return properties(s);}
async function propertyTarget(s:Session,control:Locator):Promise<void>{await reveal(s,propertyScroll(s),control);await target(control);}
async function inputSize(control:Locator):Promise<void>{expect(await control.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize)),'property input text size').toBeGreaterThanOrEqual(16);}






interface IcWindow extends Window { ic: { mark():void; finish():Promise<Record<string,unknown>>; stop():void } }
interface IdTouchAuditWindow extends Window { idTouchAudit?: { target: Element; handler: EventListener; events: { type: string; pointerId: number; pointerType: string; trusted: boolean }[] } }

const ID_CASES=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1040,720]].map(([width,height])=>({theme,width,height})));
async function idActivate(s:Session,control:Locator):Promise<void>{
 if(await s.page.evaluate(()=>navigator.maxTouchPoints>0))await control.tap();else await control.click();await settle(s.page);
}
async function idTouchDrag(s:Session,from:{x:number;y:number},to:{x:number;y:number},cancel=false):Promise<void>{
 const cdp=await s.context.newCDPSession(s.page);let active=false,primary:unknown;const cleanup:unknown[]=[];
 try{
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});active=true;
  for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/5,y:from.y+(to.y-from.y)*i/5,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});active=false;
 }catch(error){primary=error;}
 if(active){try{await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch(error){cleanup.push(error);}}
 try{await cdp.detach();}catch(error){cleanup.push(error);}
 if(primary!==undefined){if(cleanup.length)throw new AggregateError([primary,...cleanup],'ID_TOUCH_AND_CLEANUP');throw primary;}
 if(cleanup.length)throw new AggregateError(cleanup,'ID_TOUCH_CLEANUP');await settle(s.page);
}
async function idDialogUi(s:Session,entry:Locator):Promise<void>{
 const dialog=s.page.getByRole('dialog',{name:'图片对比',exact:true}),r=await dialog.boundingBox(),v=s.page.viewportSize()!;
 if(!r)throw Error('ID_DIALOG_RECT');
 expect(r.x,'comparison left safe margin').toBeGreaterThanOrEqual(8);expect(r.y,'comparison top safe margin').toBeGreaterThanOrEqual(8);
 expect(r.x+r.width,'comparison right safe margin').toBeLessThanOrEqual(v.width-8);expect(r.y+r.height,'comparison bottom safe margin').toBeLessThanOrEqual(v.height-8);
 for(const name of ['A','B'])await expect.poll(()=>dialog.getByAltText(name,{exact:true}).evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);
 const slider=dialog.getByRole('slider',{name:'对比分界',exact:true}),close=dialog.getByRole('button',{name:'关闭图片对比',exact:true});
 await target(slider);await target(close);expect(await slider.getAttribute('aria-valuenow')).toBe('50');
 const handle=await slider.boundingBox(),area=await slider.locator('..').boundingBox();if(!handle||!area)throw Error('ID_SLIDER_BOUNDS');
 const touch=await s.page.evaluate(()=>navigator.maxTouchPoints>0),from={x:handle.x+handle.width/2,y:handle.y+handle.height/2},to={x:area.x+area.width*.75,y:from.y};
 if(touch)await idTouchDrag(s,from,to);else{
  await s.page.mouse.move(from.x,from.y);await s.page.mouse.down();await settle(s.page);await s.page.mouse.move(to.x,to.y);await settle(s.page);await s.page.mouse.up();await settle(s.page);
 }
 expect(await slider.getAttribute('aria-valuenow'),'native pointer moves comparison from50to75').toBe('75');
 await slider.focus();await s.page.keyboard.press('ArrowRight');await settle(s.page);expect(await slider.getAttribute('aria-valuenow')).toBe('80');
 await s.page.keyboard.press('Home');await settle(s.page);expect(await slider.getAttribute('aria-valuenow')).toBe('0');
 await s.page.keyboard.press('End');await settle(s.page);expect(await slider.getAttribute('aria-valuenow')).toBe('100');
 for(let i=0;i<10;i++)await s.page.keyboard.press('ArrowLeft');await settle(s.page);expect(await slider.getAttribute('aria-valuenow')).toBe('50');
 let cancelled:number|null=null;
 if(touch){
  await slider.evaluate(target=>{const events:{type:string;pointerId:number;pointerType:string;trusted:boolean}[]=[];
   const handler:EventListener=event=>{const p=event as PointerEvent;events.push({type:p.type,pointerId:p.pointerId,pointerType:p.pointerType,trusted:p.isTrusted});};
   for(const type of ['pointerdown','pointercancel','lostpointercapture'])target.addEventListener(type,handler,{passive:true});
   (window as unknown as IdTouchAuditWindow).idTouchAudit={target,handler,events};});
  let primary:unknown;
  try{
   const h=await slider.boundingBox();if(!h)throw Error('ID_CANCEL_HANDLE');
   await idTouchDrag(s,{x:h.x+h.width/2,y:h.y+h.height/2},{x:area.x+area.width*.6,y:h.y+h.height/2},true);
   cancelled=Number(await slider.getAttribute('aria-valuenow'));expect(cancelled,'touchcancel retains last applied position').toBe(60);
   const old=await slider.evaluate(target=>{const events=(window as unknown as IdTouchAuditWindow).idTouchAudit!.events,down=events.find(e=>e.type==='pointerdown');return{events,down,captured:!!down&&target.hasPointerCapture(down.pointerId)};});
   expect(old.down).toMatchObject({trusted:true,pointerType:'touch'});expect(old.captured,'cancel releases old native capture').toBe(false);
   expect(old.events.some(e=>e.type==='pointercancel'&&e.trusted&&e.pointerId===old.down!.pointerId),'trusted cancellation belongs to old gesture').toBe(true);
   const fresh=await slider.boundingBox();if(!fresh)throw Error('ID_FRESH_TOUCH_HANDLE');
   await idTouchDrag(s,{x:fresh.x+fresh.width/2,y:fresh.y+fresh.height/2},{x:area.x+area.width*.7,y:fresh.y+fresh.height/2});
   const downs=await s.page.evaluate(()=>(window as unknown as IdTouchAuditWindow).idTouchAudit!.events.filter(e=>e.type==='pointerdown'));
   expect(downs).toHaveLength(2);expect(downs[1]).toMatchObject({trusted:true,pointerType:'touch'});expect(downs[1].pointerId,'fresh native touch has new pointer identity').not.toBe(old.down!.pointerId);
   expect(Number(await slider.getAttribute('aria-valuenow')),'fresh gesture works after cancellation').toBe(70);
  }catch(error){primary=error;}
  try{await s.page.evaluate(()=>{const w=window as unknown as IdTouchAuditWindow,a=w.idTouchAudit;if(a){for(const type of ['pointerdown','pointercancel','lostpointercapture'])a.target.removeEventListener(type,a.handler);delete w.idTouchAudit;}});}catch(cleanup){if(primary!==undefined)throw new AggregateError([primary,cleanup],'ID_CANCEL_OBSERVER_AND_CLEANUP');throw cleanup;}
  if(primary!==undefined)throw primary;
 }else await s.page.mouse.move(area.x+area.width*.6,from.y);
 await s.page.mouse.move(area.x+area.width*.9,from.y);await settle(s.page);
 expect(Number(await slider.getAttribute('aria-valuenow')),'released/cancelled gesture cannot continue on later mouse move').toBe(touch?70:50);
 await idActivate(s,close);expect(await dialog.count(),'native close dismisses comparison').toBe(0);
 expect(await entry.evaluate(e=>document.activeElement===e),'comparison close restores unscaled entry focus').toBe(true);
 console.log('ID_N12_DIALOG_INPUT',JSON.stringify({viewport:v,rect:r,nativeInput:touch?'Chromium synthesized touch':'Chromium mouse',pointer75:true,keyboardBounds:true,touchCancel:touch,cancelled,close:true,focusRestored:true,physicalAndroid:false}));
}

it.each(ID_CASES)('ID $theme $width x $height valid comparison entry and native controls',async({theme,width,height})=>{
 await withSession(theme,width,height,{nodeType:'output-image'},async s=>{
  const library=toolbar(s).getByRole('button',{name:'切换节点库面板',exact:true});
  if(await library.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),library,true);await idActivate(s,library);}
  await expect.poll(()=>s.page.locator('[data-node-id="hw-result"] img').first().evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);
  await settle(s.page);const graph=await workflow(s),input=graph.nodes.find(n=>n.id==='hw-source'),output=graph.nodes.find(n=>n.id==='hw-result');
  expect(input?.type).toBe('input-image');expect(output?.type).toBe('output-image');expect(input?.config.imageUrl).not.toBe(output?.config.imageUrl);
  expect(graph.connections).toHaveLength(1);expect(graph.connections[0]).toMatchObject({fromNodeId:'hw-source',fromPortId:'out-image',toNodeId:'hw-result',toPortId:'in-image',type:'image'});
  const before=JSON.stringify(graph),card=s.page.locator('[data-node-id="hw-result"]');if(await s.page.evaluate(()=>navigator.maxTouchPoints>0))await card.tap({position:{x:35,y:15}});else await card.click({position:{x:35,y:15}});await settle(s.page);
  await expect.poll(()=>properties(s).isVisible(),{timeout:1500}).toBe(true);
  await expect.poll(()=>card.evaluate(e=>e.classList.contains('selected')),{timeout:1500}).toBe(true);
  const button=properties(s).getByRole('button',{name:'对比原图',exact:true});
  const entry={theme,width,height,compareActionCount:await button.count(),propertyVisible:await properties(s).isVisible(),card:await card.boundingBox(),property:await properties(s).boundingBox(),graphUnchanged:JSON.stringify(await workflow(s))===before,sourceType:input!.type,resultType:output!.type,validPortDirections:true,providerExecution:false};
  console.log('IC_COMPARE_PUBLIC_ENTRY',JSON.stringify(entry));expect(entry.graphUnchanged,'selecting configured result leaves graph unchanged').toBe(true);await capture(s,'id-'+theme+'-'+width+'-'+height+'-properties');
  expect(await button.count(),'valid result exposes unscaled property compare action').toBe(1);expect(await button.isVisible()).toBe(true);
  await target(button);const initial=await button.evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),insideScaledNodeLayer:!!e.closest('[data-workflow-legacy-node-layer]')};});expect(initial.hit,'native comparison target initially reachable').toBe(true);expect(initial.insideScaledNodeLayer).toBe(false);
  let primary:unknown;
  try{
   await s.page.evaluate(({sourceUrl,resultUrl})=>{
    const w=window as unknown as IcWindow;
    const rect=(e:Element|null):unknown=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    const label=(e:EventTarget|null):unknown=>e instanceof Element?{tag:e.tagName,title:e.getAttribute('title'),buttonName:e.closest('button')?.getAttribute('aria-label')??e.closest('button')?.getAttribute('title'),aria:e.getAttribute('aria-label'),node:e.closest('[data-node-id]')?.getAttribute('data-node-id'),inAside:!!e.closest('aside')}:null;
    const snap=():Record<string,unknown>=>{
     const e=document.querySelector('.node-editor-root aside button[aria-label="对比原图"]'),r=e?.getBoundingClientRect(),aside=document.querySelector('.node-editor-root aside');
     const original=document.querySelector('[data-compare-dialog] img[alt="A"]') as HTMLImageElement|null,result=document.querySelector('[data-compare-dialog] img[alt="B"]') as HTMLImageElement|null;
     return {at:performance.now(),button:rect(e),centerHit:r?label(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)):null,
      selected:[...document.querySelectorAll('[data-node-id].selected')].map(n=>n.getAttribute('data-node-id')),
      aside:{rect:rect(aside),display:aside?getComputedStyle(aside).display:null},active:label(document.activeElement),
      preview:{original:!!original,result:!!result,originalMatches:original?.getAttribute('src')===sourceUrl,resultMatches:result?.getAttribute('src')===resultUrl}};
    };
    const events:unknown[]=[],frames:Record<string,unknown>[]=[],start=performance.now();
    let raf=0,timer=0,frame=0,done=false,marked=false,pendingReason:string|null=null,frozenFinal:Record<string,unknown>|null=null,frozenElapsed:number|null=null,immediate:unknown=null,stable=0,prior='',resolve:(value:Record<string,unknown>)=>void=()=>undefined;
    const finished=new Promise<Record<string,unknown>>(r=>{resolve=r;});
    const types=['touchstart','touchend','pointerdown','pointerup','mousedown','mouseup','click','focusin','focusout'] as const;
    const handler=(event:Event):void=>{
     const point=event instanceof MouseEvent?{x:event.clientX,y:event.clientY}:event instanceof TouchEvent&&event.changedTouches.length?{x:event.changedTouches[0].clientX,y:event.changedTouches[0].clientY}:null;
     events.push({type:event.type,isTrusted:event.isTrusted,target:label(event.target),path:event.composedPath().slice(0,5).map(label),point,snapshot:snap()});
    };
    const observer=new MutationObserver(()=>{if(!done)events.push({type:'DOM-mutation',snapshot:snap()});});
    const stop=():void=>{cancelAnimationFrame(raf);clearTimeout(timer);observer.disconnect();for(const type of types)document.removeEventListener(type,handler,true);};
    const finish=(reason:string):void=>{if(done)return;if(!marked){pendingReason=reason;stop();frozenFinal=snap();frozenElapsed=performance.now()-start;return;}done=true;stop();resolve({reason,elapsed:frozenElapsed??performance.now()-start,events,frames,immediate,immediateKind:pendingReason?'frozen-at-cap-no-postcap-observation':'original-two-RAF',final:frozenFinal??snap(),sourceOnlyFixture:'valid configured input-image to output-image, not persistence or provider execution',acceptance:false});};
    const sample=():void=>{if(done)return;const value=snap();frames.push(value);frame++;const key=JSON.stringify({button:value.button,centerHit:value.centerHit,aside:value.aside,selected:value.selected,preview:value.preview});stable=marked&&key===prior?stable+1:0;prior=key;if(marked&&stable>=3){finish('stable-after-native-input');return;}if(frame>=48){finish('48-frame-cap');return;}raf=requestAnimationFrame(sample);};
    for(const type of types)document.addEventListener(type,handler,{capture:true,passive:true});
    observer.observe(document.querySelector('.node-editor-root')!,{subtree:true,attributes:true,attributeFilter:['class','style'],childList:true});
    w.ic={mark(){immediate=pendingReason?frozenFinal:snap();marked=true;if(pendingReason)finish(pendingReason);},finish(){return finished;},stop};
    raf=requestAnimationFrame(sample);timer=window.setTimeout(()=>finish('1500ms-observation-cap'),1500);
   },{sourceUrl:input!.config.imageUrl as string,resultUrl:output!.config.imageUrl as string});
   await idActivate(s,button);await s.page.evaluate(()=>(window as unknown as IcWindow).ic.mark());
   const trace=await s.page.evaluate(()=>(window as unknown as IcWindow).ic.finish());console.log('IC_COMPARE_ENTRY_TRACE',JSON.stringify({theme,width,height,initial,trace}));
   const events=trace.events as {type:string;isTrusted?:boolean;target?:{buttonName?:string}}[];
   expect(events.some(e=>e.type==='pointerdown'&&e.isTrusted&&e.target?.buttonName==='对比原图'),'trusted touch starts on actual compare button').toBe(true);
   expect(JSON.stringify(await workflow(s)),'comparison input does not modify nodes/connections').toBe(before);
   await capture(s,'id-'+theme+'-'+width+'-'+height+'-dialog');
   const dialog=s.page.getByRole('dialog',{name:'图片对比',exact:true});
   await expect.poll(()=>dialog.getByAltText('A',{exact:true}).count(),{timeout:1500}).toBe(1);
   expect(await dialog.getByAltText('A',{exact:true}).getAttribute('src'),'comparison original belongs to configured source').toBe(input!.config.imageUrl);
   expect(await dialog.getByAltText('B',{exact:true}).getAttribute('src'),'comparison result belongs to configured output').toBe(output!.config.imageUrl);
   await idDialogUi(s,button);expect(JSON.stringify(await workflow(s)),'all comparison controls preserve graph and connections').toBe(before);
  }catch(error){primary=error;}
  try{await s.page.evaluate(()=>{const w=window as unknown as IcWindow;if(w.ic){w.ic.stop();delete (w as unknown as {ic?:unknown}).ic;}});}catch(cleanup){if(primary!==undefined)throw new AggregateError([primary,cleanup],'IC_ENTRY_AND_CLEANUP');throw cleanup;}
  if(primary!==undefined)throw primary;
 });
 console.log('ID_N12_COMPLETE',JSON.stringify({theme,width,height,cleanupCompleted:true,validConfiguredFixture:true,persistenceAccepted:false,normalProviderExecutionAccepted:false,n12FullyAccepted:false,wholeMobileAccepted:false}));
},25000);

it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('fresh touch opens and closes comparison $theme $width x $height',async({theme,width,height})=>{
 await withSession(theme,width,height,{nodeType:'output-image'},async s=>{
  const library=toolbar(s).getByRole('button',{name:'切换节点库面板',exact:true});
  if(await library.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),library,true);await idActivate(s,library);}
  const before=JSON.stringify(await workflow(s)),card=s.page.locator('[data-node-id="hw-result"]');
  await card.tap({position:{x:35,y:15}});await settle(s.page);
  await expect.poll(()=>properties(s).isVisible(),{timeout:1500}).toBe(true);
  const entry=properties(s).getByRole('button',{name:'对比原图',exact:true});await target(entry);await entry.tap();await settle(s.page);
  const dialog=s.page.getByRole('dialog',{name:'图片对比',exact:true}),close=dialog.getByRole('button',{name:'关闭图片对比',exact:true});
  await expect.poll(()=>dialog.isVisible(),{timeout:1500}).toBe(true);await target(close);await close.tap();await settle(s.page);
  expect(await dialog.count()).toBe(0);expect(await entry.evaluate(e=>document.activeElement===e)).toBe(true);
  expect(JSON.stringify(await workflow(s))).toBe(before);
 });
},25000);
it.each(THEMES)('ID %s missing first source does not expose a do-nothing comparison',async theme=>{
 await withSession(theme,390,844,{nodeType:'output-image',firstUpstreamEmpty:true},async s=>{
  const library=toolbar(s).getByRole('button',{name:'切换节点库面板',exact:true});
  if(await library.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),library,true);await idActivate(s,library);}
  const graph=await workflow(s),before=JSON.stringify(graph),first=graph.connections[0],later=graph.connections[1];
  expect(graph.connections).toHaveLength(2);expect(first).toMatchObject({fromNodeId:'hw-empty-source',fromPortId:'out-image',toNodeId:'hw-result',toPortId:'in-image',type:'image'});
  expect(later).toMatchObject({fromNodeId:'hw-source',fromPortId:'out-image',toNodeId:'hw-result',toPortId:'in-image',type:'image'});
  expect(graph.nodes.find(n=>n.id===first.fromNodeId)?.config.imageUrl).toBeFalsy();expect(graph.nodes.find(n=>n.id===later.fromNodeId)?.config.imageUrl).toBeTruthy();
  await s.page.locator('[data-node-id="hw-result"]').tap({position:{x:35,y:15}});await settle(s.page);
  await expect.poll(()=>properties(s).isVisible(),{timeout:1500}).toBe(true);
  expect(await properties(s).getByRole('button',{name:'对比原图',exact:true}).count(),'first-source URL rule does not offer a do-nothing comparison').toBe(0);
  expect(await s.page.getByRole('dialog',{name:'图片对比',exact:true}).count()).toBe(0);expect(JSON.stringify(await workflow(s)),'read-only entry check preserves configured graph').toBe(before);
  console.log('ID_N12_EMPTY_FIRST_SOURCE',JSON.stringify({theme,configuredFixture:true,validPorts:true,entryAbsent:true,graphUnchanged:true,providerExecution:false}));
 });
 console.log('ID_N12_EMPTY_FIRST_SOURCE_COMPLETE',JSON.stringify({theme,cleanupCompleted:true}));
},25000);




async function openComparisonForClose(s: Session): Promise<{ entry: Locator; dialog: Locator; close: Locator; graph: string }> {
  const library = toolbar(s).getByRole('button', { name: '切换节点库面板', exact: true });
  if (await library.getAttribute('aria-pressed') === 'true') { await reveal(s, toolbar(s), library, true); await idActivate(s, library); }
  const graph = JSON.stringify(await workflow(s));
  const card = s.page.locator('[data-node-id="hw-result"]');
  if (await s.page.evaluate(() => navigator.maxTouchPoints > 0)) await card.tap({ position: { x: 35, y: 15 } });
  else await card.click({ position: { x: 35, y: 15 } });
  await settle(s.page);
  const entry = properties(s).getByRole('button', { name: '对比原图', exact: true });
  await target(entry); await idActivate(s, entry);
  const dialog = s.page.getByRole('dialog', { name: '图片对比', exact: true });
  const close = dialog.getByRole('button', { name: '关闭图片对比', exact: true });
  await target(close);
  return { entry, dialog, close, graph };
}

it.each(THEMES)('comparison close after touch drag rejects occlusion and does not click through: %s', async theme => {
  await withSession(theme, 390, 844, { nodeType: 'output-image' }, async s => {
    const { entry, dialog, close, graph } = await openComparisonForClose(s);
    const slider = dialog.getByRole('slider', { name: '对比分界', exact: true });
    await slider.evaluate(el => {
      const events: Array<{ type: string; trusted: boolean; pointerType: string }> = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) el.addEventListener(type, event => {
        const pointer = event as PointerEvent; events.push({ type, trusted: pointer.isTrusted, pointerType: pointer.pointerType });
      });
      (el as HTMLElement & { compareTouchEvents?: typeof events }).compareTouchEvents = events;
    });
    const handle = await slider.boundingBox(), area = await slider.locator('..').boundingBox();
    if (!handle || !area) throw Error('COMPARISON_TOUCH_SLIDER_BOUNDS');
    await idTouchDrag(s, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: area.x + area.width * .75, y: handle.y + handle.height / 2 });
    expect(await slider.getAttribute('aria-valuenow')).toBe('75');
    const pointerEvents = await slider.evaluate(el => (el as HTMLElement & { compareTouchEvents?: Array<{ type: string; trusted: boolean; pointerType: string }> }).compareTouchEvents ?? []);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) expect(pointerEvents.some(event => event.type === type && event.trusted && event.pointerType === 'touch')).toBe(true);
    await close.tap(); await settle(s.page);
    expect(await dialog.count(), 'touch after slider drag closes').toBe(0);
    expect(await entry.evaluate(el => document.activeElement === el)).toBe(true);
    await entry.tap(); await settle(s.page); expect(await dialog.count()).toBe(1);
    const bounds = await close.boundingBox(); if (!bounds) throw Error('COMPARISON_TOUCH_CLOSE_BOUNDS');
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await s.page.evaluate(point => {
      const state = window as Window & { compareUnderClicks?: number; compareCloseTouches?: Array<{ type: string; trusted: boolean }> };
      state.compareUnderClicks = 0; state.compareCloseTouches = [];
      const under = document.createElement('button'); under.id = 'compare-close-under-control';
      Object.assign(under.style, { position: 'fixed', left: `${point.x - 22}px`, top: `${point.y - 22}px`, width: '44px', height: '44px', zIndex: '199' });
      under.onclick = () => { state.compareUnderClicks = (state.compareUnderClicks ?? 0) + 1; }; document.body.appendChild(under);
      const button = document.querySelector('[aria-label="关闭图片对比"]'); if (!button) throw Error('COMPARISON_TOUCH_CLOSE_MISSING');
      for (const type of ['touchstart', 'touchend']) button.addEventListener(type, event => state.compareCloseTouches!.push({ type, trusted: event.isTrusted }));
    }, point);
    const client = await s.context.newCDPSession(s.page); let active = false, primary: unknown; const cleanup: unknown[] = [];
    try {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 9 }] }); active = true;
      const hit = await s.page.evaluate(point => {
        const cover = document.createElement('div'); cover.id = 'compare-close-cover';
        Object.assign(cover.style, { position: 'fixed', left: `${point.x - 25}px`, top: `${point.y - 25}px`, width: '50px', height: '50px', zIndex: '2147483647' });
        document.body.appendChild(cover); return document.elementFromPoint(point.x, point.y)?.id;
      }, point);
      expect(hit, 'cover owns the release position').toBe('compare-close-cover');
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); active = false; await settle(s.page);
      const touches = await s.page.evaluate(() => (window as Window & { compareCloseTouches?: Array<{ type: string; trusted: boolean }> }).compareCloseTouches ?? []);
      expect(touches).toEqual([{ type: 'touchstart', trusted: true }, { type: 'touchend', trusted: true }]);
      expect(await dialog.count(), 'covered release must not close').toBe(1);
      await s.page.locator('#compare-close-cover').evaluate(el => el.remove());
      expect(await close.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
      await close.tap(); await settle(s.page); expect(await dialog.count(), 'uncovered touch closes').toBe(0);
      expect(await entry.evaluate(el => document.activeElement === el)).toBe(true);
      await s.page.waitForTimeout(600);
      expect(await s.page.evaluate(() => (window as Window & { compareUnderClicks?: number }).compareUnderClicks)).toBe(0);
      await s.page.touchscreen.tap(point.x, point.y);
      expect(await s.page.evaluate(() => (window as Window & { compareUnderClicks?: number }).compareUnderClicks)).toBe(1);
      expect(JSON.stringify(await workflow(s))).toBe(graph);
    } catch (error) { primary = error; }
    if (active) { try { await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); } catch (error) { cleanup.push(error); } }
    try { await client.detach(); } catch (error) { cleanup.push(error); }
    try { await s.page.locator('#compare-close-cover, #compare-close-under-control').evaluateAll(els => els.forEach(el => el.remove())); } catch (error) { cleanup.push(error); }
    if (primary !== undefined) { if (cleanup.length) throw new AggregateError([primary, ...cleanup], 'COMPARISON_TOUCH_AND_CLEANUP'); throw primary; }
    if (cleanup.length) throw new AggregateError(cleanup, 'COMPARISON_TOUCH_CLEANUP');
  });
}, 25000);

it.each(THEMES)('comparison close keeps desktop mouse and keyboard activation: %s', async theme => {
  await withSession(theme, 1040, 720, { nodeType: 'output-image' }, async s => {
    const { entry, dialog, close, graph } = await openComparisonForClose(s);
    await close.click(); await settle(s.page); expect(await dialog.count()).toBe(0);
    await entry.click(); await settle(s.page); await close.focus(); await s.page.keyboard.press('Enter'); await settle(s.page);
    expect(await dialog.count()).toBe(0);
    await entry.click(); await settle(s.page); await close.focus(); await s.page.keyboard.press('Space'); await settle(s.page);
    expect(await dialog.count()).toBe(0); expect(await entry.evaluate(el => document.activeElement === el)).toBe(true);
    expect(JSON.stringify(await workflow(s))).toBe(graph);
  });
}, 25000);
