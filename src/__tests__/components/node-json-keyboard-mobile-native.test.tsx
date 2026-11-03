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
interface Options { preview?: boolean; asset?: 'allow' | 'deny' | 'scope'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean; buildMode?: boolean }
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
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{preview?:boolean;asset?:string;nodeType?:NodeType;config?:Record<string,unknown>;modelFixtures?:boolean;buildMode?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 process.env.COZE_PROJECT_ENV=options.buildMode?'PROD':'DEV';
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
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/playwright/node-json-ix-20261021',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_PROPERTY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }

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

// Catches focus escaping, ineffective Escape, background Delete and accidental production exposure.
async function tabToIx(s:Session,control:Locator):Promise<void>{
 for(let i=0;i<48;i++){
  if(await control.evaluate(e=>e===document.activeElement))return;
  await s.page.keyboard.press('Tab');await settle(s.page);
 }
 expect(false,'public keyboard navigation reaches the JSON entry').toBe(true);
}
async function focusedIx(control:Locator):Promise<boolean>{return control.evaluate(e=>e===document.activeElement);}
describe('IX N13 JSON modal keyboard lifecycle and production entry',()=>{
 it('contains focus, isolates background shortcuts, discards drafts and hides the production entry',async()=>{
  await withSession('gold',390,844,{nodeType:'input-image'},async s=>{
   let primary:unknown;
   try{
    await selectNode(s);
    expect(await s.page.locator('[data-node-id="hw-result"].selected').count(),'real background node is selected').toBe(1);
    await expect.poll(()=>s.page.locator('[data-node-id="hw-result"] img').first().evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);
    const before=await workflow(s),entry=s.page.getByRole('button',{name:'查看/编辑JSON',exact:true});
    await reveal(s,toolbar(s),entry,true);await target(entry);await tabToIx(s,entry);
    const open=async():Promise<void>=>{await s.page.keyboard.press('Enter');await settle(s.page);await s.page.getByRole('dialog',{name:'工作流 JSON 编辑器',exact:true}).waitFor();
     console.log('IX_JSON_OPEN',JSON.stringify(await s.page.evaluate(()=>({focusInDialog:!!document.activeElement?.closest('[role="dialog"]'),activeTag:document.activeElement?.tagName,activeName:document.activeElement?.getAttribute('aria-label')}))));
     await expect.poll(()=>focusedIx(input),{timeout:1500}).toBe(true);};
    const dialog=s.page.getByRole('dialog',{name:'工作流 JSON 编辑器',exact:true}),input=dialog.getByRole('textbox',{name:'工作流 JSON 内容',exact:true}),close=dialog.getByRole('button',{name:'关闭 JSON 编辑器',exact:true}),cancel=dialog.getByRole('button',{name:'取消',exact:true}),apply=dialog.getByRole('button',{name:'应用更改',exact:true});
    await open();
    expect(await dialog.getAttribute('aria-modal'),'modal is announced').toBe('true');
    for(const control of [close,cancel,apply])await target(control);
    const original=await input.inputValue();
    // Forward wraps apply -> close; reverse wraps close -> apply.
    for(const [key,control] of [['Tab',cancel],['Tab',apply],['Tab',close],['Shift+Tab',apply],['Shift+Tab',cancel],['Shift+Tab',input],['Shift+Tab',close]] as const){
     await s.page.keyboard.press(key);await settle(s.page);expect(await focusedIx(control),'native '+key+' stays within the dialog order').toBe(true);
    }
    await s.page.keyboard.press('Delete');await settle(s.page);
    expect(await workflow(s),'Delete on a modal button cannot delete the selected background node').toEqual(before);
    await s.page.keyboard.press('Tab');await settle(s.page);expect(await focusedIx(input)).toBe(true);
    await s.page.keyboard.press('Control+a');await s.page.keyboard.type('unapplied IX draft');
    expect(await input.inputValue()).toBe('unapplied IX draft');
    await s.page.keyboard.press('Escape');await settle(s.page);
    expect(await dialog.count(),'Escape from the textarea closes the modal').toBe(0);expect(await focusedIx(entry),'Escape restores entry focus').toBe(true);
    expect(await workflow(s),'Escape discards without graph writes').toEqual(before);
    console.log('IX_JSON_CHECKPOINT',JSON.stringify({stage:'focus-forward-reverse-delete-escape',pageErrors:s.errors.length}));
    await open();expect(await input.inputValue(),'reopen discards the unapplied draft').toBe(original);
    await s.page.keyboard.press('Tab');expect(await focusedIx(cancel),'Cancel activation is distinct').toBe(true);await s.page.keyboard.press('Enter');await settle(s.page);
    expect(await dialog.count(),'Cancel closes').toBe(0);expect(await focusedIx(entry),'Cancel restores focus').toBe(true);
    await open();await s.page.keyboard.press('Shift+Tab');expect(await focusedIx(close),'Close activation is distinct').toBe(true);await s.page.keyboard.press('Enter');await settle(s.page);
    expect(await dialog.count(),'Close closes').toBe(0);expect(await focusedIx(entry),'Close restores focus').toBe(true);
    await open();await closeBackdropHw(s);
    expect(await dialog.count(),'Backdrop closes').toBe(0);expect(await focusedIx(entry),'Backdrop restores focus').toBe(true);
    expect(await workflow(s),'all dismissal paths preserve the actual callback graph').toEqual(before);
    console.log('IX_JSON_CHECKPOINT',JSON.stringify({stage:'cancel-close-backdrop-draft-held',pageErrors:s.errors.length}));
   }catch(error){primary=error;}
   try{await capture(s,'ix-gold-390-844-keyboard-final');}catch(error){if(primary!==undefined)throw new AggregateError([primary,error],'IX_TEST_AND_CAPTURE');throw error;}
   if(primary!==undefined)throw primary;
  });
  for(const [theme,width,height] of [['gold',320,640],['mono',844,390]] as const){
   await withSession(theme,width,height,{nodeType:'input-image',buildMode:true},async s=>{
    let primary:unknown;
    try{
     expect(await s.page.getByRole('button',{name:'查看/编辑JSON',exact:true}).count(),'PROD hides the developer entry').toBe(0);
     expect(await toolbar(s).count()).toBe(1);expect(await s.page.getByRole('button',{name:'切换节点库面板',exact:true}).count()).toBe(1);
     await expect.poll(()=>s.page.locator('[data-node-id="hw-result"] img').first().evaluate(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth===48),{timeout:1500}).toBe(true);
     expect((await workflow(s)).nodes.map(n=>n.id)).toEqual(['hw-source','hw-result']);
     console.log('IX_JSON_PROD',JSON.stringify({theme,width,height,pageErrors:s.errors.length,realProductionBuild:false}));
    }catch(error){primary=error;}
    try{await capture(s,'ix-'+theme+'-'+width+'-'+height+'-prod-final');}catch(error){if(primary!==undefined)throw new AggregateError([primary,error],'IX_TEST_AND_CAPTURE');throw error;}
    if(primary!==undefined)throw primary;
   });
  }
  console.log('IX_JSON_COMPLETE',JSON.stringify({selected:1,contexts:3,physicalAndroid:false,coze:false}));
 },25000);
});
