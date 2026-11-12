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
import { createWorkflowNode, createConnection, type Workflow, type NodeType } from '@/lib/workflow-engine';

type Theme = 'gold' | 'mono';
interface Options { preview?: boolean; asset?: 'allow' | 'deny' | 'scope'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean }
interface FixtureWindow extends Window { nodeProperty: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null; imageReads: number; downloadReads: number; releasePreview: () => void }
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
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{preview?:boolean;asset?:string;nodeType?:NodeType;config?:Record<string,unknown>;modelFixtures?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)throw Error('NODE_PROPERTY_FIXTURE_CANVAS');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,48,48);const url=canvas.toDataURL();
 const workflow={...createEmptyWorkflow('离线目录验收工作流'),id:'ui-node-workflow'};
 const node=createWorkflowNode(options.nodeType||'input-param',40,60,'离线属性节点');node.id='hw-result';node.type='input-image';node.x=20;node.y=10;node.config={...node.config,imageUrl:url,source:'url'};
 const source=createWorkflowNode('input-image',-500,-500,'离线原图节点');source.id='hw-source';ctx.fillStyle='#d4af37';ctx.fillRect(0,0,48,48);source.config={...source.config,imageUrl:canvas.toDataURL(),source:'url'};workflow.nodes=[source,node];workflow.connections=[createConnection(source.id,'out-image',node.id,'in-image','image')];
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
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/playwright/node-json-iv-20261021',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_PROPERTY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }

function properties(s:Session):Locator{return s.page.getByText('节点属性',{exact:true}).locator('../..');}
function propertyScroll(s:Session):Locator{return properties(s).locator(':scope > div').last();}
async function selectNode(s:Session):Promise<Locator>{const entry=s.page.getByRole('button',{name:'切换节点库面板',exact:true});if(await entry.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),entry,true);await entry.click();await settle(s.page);}const card=s.page.locator('[data-node-id][aria-label="离线属性节点"]');await card.waitFor();await card.click({position:{x:15,y:15}});await settle(s.page);await properties(s).getByRole('button',{name:'关闭节点属性',exact:true}).waitFor();return properties(s);}
async function propertyTarget(s:Session,control:Locator):Promise<void>{await reveal(s,propertyScroll(s),control);await target(control);}
async function inputSize(control:Locator):Promise<void>{expect(await control.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize)),'property input text size').toBeGreaterThanOrEqual(16);}



const CASES=[{theme:'gold' as Theme,width:390,height:844}];
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

describe('IV N13 element shapes and nonempty compatibility',()=>{
 it.each(CASES)('$theme $width x $height rejects malformed and unlisted entries before mutation and preserves nonempty native extensions',async({theme,width,height})=>{
  await withSession(theme,width,height,{nodeType:'input-image'},async s=>{
   let primary:unknown;const faults:{name:string;message:string;stack:string}[]=[];let overflow=false;
   const observe=(error:Error):void=>{if(faults.length>=8){overflow=true;return;}const row={name:error.name,message:error.message.slice(0,1000),stack:String(error.stack??'').slice(0,3000)};faults.push(row);console.log('IV_PAGE_ERROR',JSON.stringify(row));};
   s.page.on('pageerror',observe);
   try{
    const library=toolbar(s).getByRole('button',{name:'切换节点库面板',exact:true});
    if(await library.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),library,true);await activateHw(s,library);}
    await expect.poll(()=>s.page.locator('[data-node-id="hw-result"] img').first().evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);await settle(s.page);
    const initial=await workflow(s),baseline=JSON.stringify(initial),json=toolbar(s).getByTitle('查看/编辑JSON',{exact:true});
    await reveal(s,toolbar(s),json,true);await activateHw(s,json);
    const dialog=s.page.getByRole('dialog',{name:'工作流 JSON 编辑器',exact:true});await dialog.waitFor();
    const input=dialog.getByRole('textbox',{name:'工作流 JSON 内容',exact:true}),apply=dialog.getByRole('button',{name:'应用更改',exact:true});
    const node=createWorkflowNode('input-param',20,10,'IV 结构样本'),port={id:'iv-port',label:'测试',type:'data',direction:'out'};
    node.id='iv-shape-node';const edge={id:'iv-edge',fromNodeId:'iv-a',fromPortId:'out',toNodeId:'iv-b',toPortId:'in',type:'data'};
    const text=(nodes:unknown[],connections:unknown[]=[]):string=>JSON.stringify({nodes,connections});
    const payloads=[
     {id:'node-null',text:text([null])},{id:'node-array',text:text([[]])},
     {id:'node-type-number',text:text([{...node,type:7}])},{id:'node-id-object',text:text([{...node,id:{bad:true}}])},
     {id:'node-label-object',text:text([{...node,label:{bad:true}}])},{id:'node-x-string',text:text([{...node,x:'20'}])},
     {id:'node-width-null',text:text([{...node,width:null}])},{id:'node-config-null',text:text([{...node,config:null}])},
     {id:'node-config-array',text:text([{...node,config:[]}])},{id:'node-ports-null',text:text([{...node,ports:null}])},
     {id:'port-null',text:text([{...node,ports:[null]}])},{id:'port-id-number',text:text([{...node,ports:[{...port,id:7}]}])},
     {id:'port-label-object',text:text([{...node,ports:[{...port,label:{bad:true}}]}])},{id:'port-type-number',text:text([{...node,ports:[{...port,type:7}]}])},
     {id:'port-direction-invalid',text:text([{...node,ports:[{...port,direction:'sideways'}]}])},
     {id:'connection-null',text:text([node],[null])},{id:'connection-id-number',text:text([node],[{...edge,id:7}])},
     {id:'connection-endpoint-object',text:text([node],[{...edge,toNodeId:{bad:true}}])},{id:'connection-type-object',text:text([node],[{...edge,type:{bad:true}}])},
     {id:'node-infinite-x',text:text([{...node,x:20}]).replace('"x":20','"x":1e999')},
    ];
    expect(payloads.length,'named shape inputs').toBe(20);console.log('IV_JSON_CHECKPOINT',JSON.stringify({stage:'opened',payloadIds:payloads.map(p=>p.id)}));
    const verifyRejection=async(payload:{id:string;text:string},previousWorkflow:string):Promise<void>=>{
     await input.fill(payload.text);expect(await dialog.getByRole('alert').count(),'editing clears prior error').toBe(0);await target(apply);await activateHw(s,apply);
     const unchanged=JSON.stringify(await workflow(s))===previousWorkflow;
     console.log('IV_JSON_OBSERVATION',JSON.stringify({id:payload.id,dialogCount:await dialog.count(),callbackAndGraphUnchanged:unchanged,pageErrors:s.errors.length,observedPageErrors:faults.length,observerOverflow:overflow}));
     expect(await dialog.count(),'rejected entry retains the editor').toBe(1);
     expect(await input.inputValue(),'rejected entry text is retained').toBe(payload.text);expect(unchanged,'rejected entry leaves the last legitimate workflow intact').toBe(true);
     const alert=dialog.getByRole('alert');expect(await alert.count(),'rejected entry gives feedback before updateWorkflow').toBe(1);
     expect(await alert.isVisible(),'validation feedback is visible').toBe(true);expect((await alert.innerText()).trim().length).toBeGreaterThan(0);
     expect(await input.getAttribute('aria-invalid')).toBe('true');const id=await alert.getAttribute('id');expect(id).toBeTruthy();expect((await input.getAttribute('aria-describedby')??'').split(/\s+/)).toContain(id);
     console.log('IV_JSON_REJECTED',JSON.stringify({id:payload.id,textRetained:true,graphUnchanged:true,visibleAssociatedError:true}));
    };
    for(const payload of payloads) await verifyRejection(payload,baseline);
    const imageUrl=String(initial.nodes.find(n=>n.id==='hw-result')?.config.imageUrl??'');expect(imageUrl.startsWith('data:image/png;base64,')).toBe(true);
    const source=createWorkflowNode('input-image',20,10,'IV 原图扩展');source.id='iv-source';source.config={...source.config,imageUrl,source:'url',customNested:{empty:'',zero:0,flag:false,items:[1,'x']}};
    const output=createWorkflowNode('output-image',20,280,'IV 输出扩展');output.id='iv-output';
    const link={...createConnection(source.id,'out-image',output.id,'in-image','image'),id:'iv-compatible-edge',customEdge:{retained:true}};
    const extended={...source,customNode:{retained:true},ports:source.ports.map(p=>({...p,customPort:{retained:true}}))};
    const edit=createWorkflowNode('ai-edit',20,10,'IV 旧蒙版端口');edit.id='iv-legacy-edit';edit.ports=edit.ports.filter(p=>p.id!=='in-mask');
    const legacyExpected={...edit,ports:[...edit.ports,{id:'in-mask',label:'蒙版',type:'mask',direction:'in'}]};
    const positives=[
     {id:'native-extensions',payload:{nodes:[extended,output],connections:[link]},expected:{nodes:[extended,output],connections:[link]}},
     {id:'legacy-edit-mask',payload:{nodes:[edit],connections:[]},expected:{nodes:[legacyExpected],connections:[]}},
    ];
    const withoutSize=(value:{nodes:unknown[];connections:unknown[]}):unknown=>({...value,nodes:value.nodes.map(value=>{const {width:_width,height:_height,...fields}=value as Record<string,unknown>;return fields;})});
    for(const positive of positives){
     await input.fill(JSON.stringify(positive.payload,null,2));await target(apply);await activateHw(s,apply);
     await expect.poll(async()=>{const actual=await workflow(s),boxes=await s.page.locator('[data-node-id]').evaluateAll(elements=>Object.fromEntries(elements.map(e=>{const style=getComputedStyle(e),n=(k:string):number=>Number.parseFloat(style.getPropertyValue(k))||0;return[e.getAttribute('data-node-id'),{width:n('width')-(style.boxSizing==='border-box'?n('padding-left')+n('padding-right')+n('border-left-width')+n('border-right-width'):0),height:n('height')-(style.boxSizing==='border-box'?n('padding-top')+n('padding-bottom')+n('border-top-width')+n('border-bottom-width'):0)}];}))) as Record<string,{width:number;height:number}>;
      return{graph:withoutSize({nodes:actual.nodes,connections:actual.connections}),id:actual.id,name:actual.name,version:actual.version,createdAt:actual.createdAt,dialogCount:await dialog.count(),measured:actual.nodes.length===positive.expected.nodes.length&&actual.nodes.every(n=>Number.isFinite(n.width)&&Number.isFinite(n.height)&&!!boxes[n.id]&&Math.abs(n.width-boxes[n.id].width)<=2&&Math.abs(n.height-boxes[n.id].height)<=2)};
     },{timeout:1500}).toEqual({graph:withoutSize(positive.expected),id:initial.id,name:initial.name,version:initial.version,createdAt:initial.createdAt,dialogCount:0,measured:true});
     const applied=await workflow(s);for(const n of applied.nodes)expect(await s.page.locator('[data-node-id="'+n.id+'"]').getAttribute('aria-label')).toBe(n.label);
     await reveal(s,toolbar(s),json,true);await activateHw(s,json);await dialog.waitFor();
     expect(JSON.parse(await input.inputValue()),'reopen reads actual verified graph').toEqual({nodes:applied.nodes,connections:applied.connections});expect(await dialog.getByRole('alert').count()).toBe(0);
     console.log('IV_JSON_ACCEPTED',JSON.stringify({id:positive.id,callbackAndRenderedGraphMatched:true,outerIdentityHeld:true,sameMountReopen:true}));
    }
    const unlisted={...node,id:'iv-fallback',type:'iv-unlisted-extension',label:'IV 未列名字符串扩展',config:{...node.config,customNested:{flag:false,zero:0,empty:''}}};
    await verifyRejection({id:'unlisted-node-type',text:JSON.stringify({nodes:[unlisted],connections:[]},null,2)},JSON.stringify(await workflow(s)));
    expect(await s.page.locator('[data-node-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-node-id'))),'unlisted node type leaves the rendered graph intact').toEqual([edit.id]);
    expect(overflow,'readonly page-error observer did not overflow').toBe(false);expect(faults.length,'no page errors may be allowed').toBe(0);
   }catch(error){primary=error;}
   try{await capture(s,'iv-'+theme+'-'+width+'-'+height+'-json-elements-final');}catch(error){s.page.off('pageerror',observe);if(primary!==undefined)throw new AggregateError([primary,error],'IV_PRIMARY_AND_CAPTURE');throw error;}
   s.page.off('pageerror',observe);console.log('IV_PAGE_OBSERVER_FINAL',JSON.stringify({count:faults.length,overflow,errorsRemainOriginalFailures:true}));
   if(primary!==undefined)throw primary;
  });
  console.log('IV_JSON_COMPLETE',JSON.stringify({theme,width,height,cleanupCompleted:true,elementCases:20,positiveControls:2,unlistedTypeRejected:true,onlySameMountRetention:true,databasePersistenceProven:false,fullN13Accepted:false,wholeMobileAccepted:false,physicalAndroid:false}));
 },25000);
});
