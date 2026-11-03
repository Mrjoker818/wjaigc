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
interface Options { asset?: 'allow' | 'deny' | 'scope'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean }
interface FixtureWindow extends Window { nodeProperty: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null }
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
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{asset?:string;nodeType?:NodeType;config?:Record<string,unknown>;modelFixtures?:boolean}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');if(!ctx)throw Error('NODE_PROPERTY_FIXTURE_CANVAS');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,48,48);const url=canvas.toDataURL();
 const workflow={...createEmptyWorkflow('离线目录验收工作流'),id:'ui-node-workflow'};
 const node=createWorkflowNode(options.nodeType||'input-param',40,60,'离线属性节点');node.config={...node.config,...options.config};workflow.nodes=[node];
 const images=[{id:'ui-source-image',url,name:'离线规范素材',description:'离线规范素材',width:48,height:48,assetId:'ui-source-asset',assetVersionId:'ui-source-version',placementId:'ui-source-placement',projectId:options.asset==='scope'?'ui-other-project':'ui-node-project'}];
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
 root.render(<NodeEditor taskModelCatalog={options.modelFixtures?offlineModelCatalog:[]} taskModelOptions={options.modelFixtures?offlineModelOptions:[]} workflow={workflow} userId="ui-node-actor" projectId="ui-node-project" canvasDocumentMode themeStyle={theme==='mono'?'monochrome':'gold'} canvasImages={images}
 onWorkflowChange={value=>{state.workflow=value;}} onBack={()=>{throw Error('NODE_PROPERTY_FIXTURE_UNEXPECTED_NAVIGATION')}}/>);
},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('NODE_PROPERTY_FIXTURE_NATIVE_LOADER');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
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
  if (!browser) throw Error('NODE_PROPERTY_FIXTURE_BROWSER_REQUIRED'); const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' }); contexts.add(context); let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), waiters: new Set(), mounted: false, canonicalUrl: null }; value = s; live.add(s);
    context.on('request', r => s.pending.add(r)); context.on('requestfinished', r => { s.pending.delete(r); s.completed.add(r); for (const notify of s.waiters) notify(); }); context.on('requestfailed', r => { s.pending.delete(r); s.failed.add(r); for (const notify of s.waiters) notify(); });
    page.on('pageerror', e => s.errors.push(String(e))); page.on('dialog', dialog => { s.errors.push('NODE_PROPERTY_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('NODE_PROPERTY_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key']) throw Error('NODE_PROPERTY_FIXTURE_HTTP_BOUNDARY');
        const key = request.method() + ' ' + url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count); if (count !== 1) throw Error('NODE_PROPERTY_FIXTURE_HTTP_COUNT ' + key);
        if (key === 'GET /' && request.isNavigationRequest() && request.postData() === null) { await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="fixture-root"></div></body></html>` }); return; }
        if (key === 'GET /api/skills?surface=workflow' && request.postData() === null) { await route.fulfill({ json: { skills: [] } }); return; }
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
  } catch (error) { try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } } catch (cleanup) { throw new AggregateError([error, cleanup], 'NODE_PROPERTY_FIXTURE_BOOTSTRAP'); } throw error; }
}
async function nativeFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined; try { await bounded('native requests', () => new Promise<void>(resolve => { notify = () => { if (!s.pending.size) resolve(); }; s.waiters.add(notify); notify(); })); } finally { if (notify) s.waiters.delete(notify); }
}
async function dispose(s: Session, refusal?: 'http' | 'websocket', cleanupProbe?: () => void): Promise<void> {
  const failures: unknown[] = [];
  try { if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).nodeProperty.unmount())); cleanupProbe?.(); } catch (e) { failures.push(e); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); await nativeFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (e) { failures.push(e); }
  const pending = s.pending.size !== 0 || s.handlers.size !== 0; try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (e) { failures.push(e); }
  const invalid = (code: string): never => { if (failures.length) throw new AggregateError([Error(code), ...failures], 'NODE_PROPERTY_FIXTURE_VALIDATION_AND_CLEANUP'); throw Error(code); };
  const expected = ['GET /', 'GET /api/skills?surface=workflow']; if (['allow', 'deny'].includes(s.options.asset ?? '')) expected.push('POST /api/assets'); if (refusal === 'http') expected.push('GET /unexpected');
  if (JSON.stringify([...s.counts.keys()].sort()) !== JSON.stringify(expected.sort()) || [...s.counts.values()].some(n => n !== 1)) invalid('NODE_PROPERTY_FIXTURE_REQUEST_VALIDATION');
  const failed = [...s.failed], refused = [...s.refused], key = (r: Request): string => r.method() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search;
  if (pending || s.pending.size || (refusal === 'http' ? failed.length !== 1 || refused.length !== 1 || failed[0] !== refused[0] || key(failed[0]) !== 'GET /unexpected' : failed.length !== 0 || refused.length !== 0)
    || JSON.stringify([...s.completed].map(key).sort()) !== JSON.stringify(expected.filter(k => k !== 'GET /unexpected').sort())) invalid('NODE_PROPERTY_FIXTURE_NATIVE_REQUEST_FAILURE');
  if (failures.length) throw Error('NODE_PROPERTY_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (refusal) { const e = refusal === 'http' ? 'Error: NODE_PROPERTY_FIXTURE_UNKNOWN_HTTP GET /unexpected' : 'NODE_PROPERTY_FIXTURE_UNKNOWN_WS'; if (s.errors.length !== 1 || s.errors[0] !== e) throw Error('NODE_PROPERTY_FIXTURE_UNEXPECTED_FAILURES'); }
  if (s.errors.length) throw Error('NODE_PROPERTY_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(theme: Theme, width: number, height: number, options: Options, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height, options); let primary: unknown; try { await run(s); } catch (e) { primary = e; }
  try { await dispose(s); } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'NODE_PROPERTY_FIXTURE_TEST_AND_CLEANUP'); throw cleanup; } if (primary) throw primary;
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

describe('node property red shell',()=>{it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height closes without editing a node',async({theme,width,height})=>{await withSession(theme,width,height,{},async s=>{const p=await selectNode(s),before=JSON.stringify(await workflow(s)),close=p.getByRole('button',{name:'关闭节点属性',exact:true});await target(close);await close.click();expect(await p.isVisible()).toBe(false);expect(JSON.stringify(await workflow(s))).toBe(before);});},25000);});
describe('node property red inputs',()=>{it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps primitive inputs legible and touch-sized',async({theme,width,height})=>{await withSession(theme,width,height,{nodeType:'input-param'},async s=>{const p=await selectNode(s);for(const key of ['label','paramType','value','min','max']){const c=p.locator('[data-node-field="'+key+'"] input,[data-node-field="'+key+'"] select');await propertyTarget(s,c);await inputSize(c);}});},25000);});
describe('node property red labels',()=>{it.each(THEMES)('%s associates a visible name label with the editable input',async theme=>{await withSession(theme,390,844,{},async s=>{const p=await selectNode(s);expect(await p.getByLabel('名称',{exact:true}).count(),'property label association').toBe(1);const name=p.getByLabel('名称',{exact:true});await p.locator('[data-node-field="label"] label').click();expect(await name.evaluate(e=>document.activeElement===e),'label focuses its input').toBe(true);});},25000);});
describe('node property red range',()=>{it.each(THEMES)('%s gives sliders a complete usable target',async theme=>{await withSession(theme,390,844,{nodeType:'video-speed-change'},async s=>{const p=await selectNode(s);await propertyTarget(s,p.locator('[data-node-field="speed"] input[type="range"]'));});},25000);});
describe('node property red toggle',()=>{it.each(THEMES)('%s exposes a named touch-sized toggle state',async theme=>{await withSession(theme,390,844,{nodeType:'video-speed-change'},async s=>{const p=await selectNode(s),toggle=p.locator('[data-node-field="preservePitch"] button');await propertyTarget(s,toggle);expect(await toggle.getAttribute('role'),'toggle has switch semantics').toBe('switch');expect(await toggle.getAttribute('aria-checked')).toBe('true');await toggle.click();expect((await workflow(s)).nodes[0].config.preservePitch).toBe(false);expect(await toggle.getAttribute('aria-checked')).toBe('false');});},25000);});
describe('node property red quality',()=>{it.each(THEMES)('%s keeps every quality choice inside the narrow panel',async theme=>{await withSession(theme,320,640,{nodeType:'ai-generate'},async s=>{const p=await selectNode(s);for(const c of await p.locator('[data-node-field="quality"] button').all())await propertyTarget(s,c);});},25000);});
describe('node property red upload',()=>{it.each(THEMES)('%s exposes image upload as a keyboard-reachable button',async theme=>{await withSession(theme,390,844,{nodeType:'input-image'},async s=>{const p=await selectNode(s),upload=p.getByRole('button',{name:'上传图片',exact:true});expect(await upload.count(),'image upload button is reachable').toBe(1);await propertyTarget(s,upload);const chooser=s.page.waitForEvent('filechooser');await upload.focus();await s.page.keyboard.press('Enter');await chooser;expect(s.counts.has('POST /api/upload')).toBe(false);});},25000);});

const NODE_TYPES:readonly NodeType[]=["input-image","input-text","input-param","input-video","audio-input","ai-generate","ai-edit","ai-annotation-edit","ai-retouch","ai-upscale","ai-removebg","ai-vectorize","ai-style-transfer","ai-color-adjust","ai-analyze","ai-font-design","ai-refine-engine","ai-human-repair","ai-brand-ecommerce","ai-segment","ai-multi-angle","ai-3d-model","ai-panorama","ai-video-generate","ai-video-i2v","ai-llm","ai-audio","ai-skill","ai-sketch-to-code","ai-sketch-to-image","video-speed-change","video-filter","video-concat","video-trim","video-extract-frames","video-compose","manual-color-adjust","condition-if","condition-switch","loop-for","loop-while","loop-each","parallel","agent-auto","agent-chat","subgraph","group","storyboard-sequence","output-image","output-save","output-export","output-image-group","output-video","output-audio"];
describe('node property defaults matrix',()=>{it.each(THEMES.flatMap(theme=>NODE_TYPES.map(nodeType=>({theme,nodeType}))))('$theme $nodeType keeps default schema field controls usable in the real panel',async({theme,nodeType})=>{await withSession(theme,theme==='gold'?320:390,theme==='gold'?640:844,{nodeType},async s=>{const p=await selectNode(s);expect(await p.getByLabel('名称',{exact:true}).count(),'property label association').toBe(1);if(nodeType==='ai-skill'){const skill=p.getByRole('combobox',{name:'Skill',exact:true});await propertyTarget(s,skill);await inputSize(skill);}const fields=await p.locator('[data-node-field]').all();expect(fields.length,'default fields are present').toBeGreaterThan(0);for(const field of fields){const cs=await field.locator('input:not([type="file"]),textarea,select,button').all();let visible=0;for(const c of cs){if(!await c.isVisible())continue;visible++;await propertyTarget(s,c);const tag=await c.evaluate(e=>({tag:e.tagName,type:e.getAttribute('type')}));if(['INPUT','TEXTAREA','SELECT'].includes(tag.tag)&&tag.type!=='range')await inputSize(c);}expect(visible,'every default field has a usable control').toBeGreaterThan(0);}const del=p.getByRole('button',{name:'删除节点',exact:true});await propertyTarget(s,del);if(nodeType==='input-param'||nodeType==='ai-generate'){const name=p.getByLabel('名称',{exact:true});await propertyTarget(s,name);await capture(s,theme+'-'+nodeType);if(nodeType==='input-param'){const before=JSON.stringify(await workflow(s));await s.page.setViewportSize({width:1440,height:900});await settle(s.page);await propertyTarget(s,name);await inputSize(name);expect(JSON.stringify(await workflow(s))).toBe(before);await capture(s,theme+'-desktop-properties');await s.page.setViewportSize({width:640,height:320});await settle(s.page);await propertyTarget(s,name);await target(p.getByRole('button',{name:'关闭节点属性',exact:true}));expect(JSON.stringify(await workflow(s))).toBe(before);await capture(s,theme+'-rotated-properties');}}});},25000);});

describe('node property operations',()=>{it.each(THEMES)('%s commits editable values and preserves the original undo transaction',async theme=>{await withSession(theme,390,844,{nodeType:'input-param'},async s=>{const p=await selectNode(s),name=p.getByLabel('名称',{exact:true}),min=p.getByLabel('最小值',{exact:true});await propertyTarget(s,name);await name.fill('已编辑的节点');await name.press('Tab');expect((await workflow(s)).nodes[0].label).toBe('已编辑的节点');await propertyTarget(s,min);await min.fill('42');await min.press('Tab');expect((await workflow(s)).nodes[0].config.min).toBe(42);await undo(s);expect((await workflow(s)).nodes[0].config.min).toBeUndefined();expect((await workflow(s)).nodes[0].label).toBe('已编辑的节点');});},25000);});
describe('node property fixture boundary',()=>{
  it('preserves request and cleanup faults together rather than losing either diagnostic',async()=>{
    const s=await session('gold',390,844,{asset:'allow'});let failure:unknown;try{await dispose(s,undefined,()=>{throw Error('NODE_PROPERTY_FIXTURE_INJECTED_CLEANUP');});}catch(e){failure=e;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors.map(String)).toEqual(['Error: NODE_PROPERTY_FIXTURE_REQUEST_VALIDATION','Error: NODE_PROPERTY_FIXTURE_INJECTED_CLEANUP']);expect(live.has(s)).toBe(false);
  },25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{
    const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* expected */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const socket=new WebSocket('wss://unexpected.invalid');const timer=setTimeout(()=>reject(Error('NODE_PROPERTY_FIXTURE_WS_TIMEOUT')),1500);socket.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'NODE_PROPERTY_FIXTURE_INFRASTRUCTURE: Error: NODE_PROPERTY_FIXTURE_UNKNOWN_HTTP GET /unexpected':'NODE_PROPERTY_FIXTURE_INFRASTRUCTURE: NODE_PROPERTY_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}
  },25000);
  it.each(['http','websocket'] as const)('cannot absorb cleanup failure into expected %s refusal',async transport=>{
    const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* expected */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const socket=new WebSocket('wss://unexpected.invalid');const timer=setTimeout(()=>reject(Error('NODE_PROPERTY_FIXTURE_WS_TIMEOUT')),1500);socket.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('NODE_PROPERTY_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('NODE_PROPERTY_FIXTURE_CLEANUP_FAILURE: Error: NODE_PROPERTY_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}
  },25000);
});


describe('node property optional quality',()=>{it.each(THEMES)('%s allows the existing sketch-image optional quality text to be entered',async theme=>{await withSession(theme,390,844,{nodeType:'ai-sketch-to-image'},async s=>{const p=await selectNode(s),quality=p.locator('[data-node-field="quality"] input[type="text"]');expect(await quality.count(),'optional quality input exists').toBe(1);await propertyTarget(s,quality);await quality.fill('standard');await quality.press('Tab');expect((await workflow(s)).nodes[0].config.quality).toBe('standard');});},25000);});

describe('node property review labels',()=>{it.each(THEMES.flatMap(theme=>(['duplicate','sketch'] as const).map(kind=>({theme,kind}))))('$theme $kind keeps visible labels bound to their own field instance',async({theme,kind})=>{await withSession(theme,390,844,{nodeType:kind==='duplicate'?'ai-llm':'ai-sketch-to-image',modelFixtures:true},async s=>{const p=await selectNode(s);const fields=kind==='duplicate'?p.locator('[data-node-field="model"]'):p.locator('[data-node-field="visionModel"],[data-node-field="imageModel"]');expect(await fields.count(),'expected real field instances').toBe(2);for(const f of await fields.all()){const label=f.locator(':scope > label'),control=f.locator('select');expect(await control.count(),'field has its own model control').toBe(1);expect(await control.isEnabled(),'offline model control is enabled').toBe(true);expect(await label.evaluate(e=>(e as HTMLLabelElement).control===e.parentElement?.querySelector('select')),'visible label controls its field instance').toBe(true);await reveal(s,propertyScroll(s),label);await label.click();expect(await control.evaluate(e=>document.activeElement===e),'visible model label focuses its own control').toBe(true);}});},25000);});

async function textContrast(control: Locator, placeholder = false): Promise<number> {
  return control.evaluate((element, isPlaceholder) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('NODE_PROPERTY_FIXTURE_CONTRAST_CANVAS');
    type Rgba = [number, number, number, number]; type Rgb = [number, number, number];
    const rgba = (value: string): Rgba => {
      if (!CSS.supports('color', value) || /^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value)) throw Error('NODE_PROPERTY_FIXTURE_CONTRAST_COLOR');
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const blend = (front: Rgba, back: Rgb): Rgb => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])) as Rgb;
    const luminance = (rgb: Rgb): number => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (ratio([255, 255, 255], [255, 255, 255]) !== 1 || Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) > 0.000001) throw Error('NODE_PROPERTY_FIXTURE_CONTRAST_CANARY');
    const layers: Rgba[] = []; let opaque = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backgroundImage !== 'none') throw Error('NODE_PROPERTY_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
      const color = rgba(style.backgroundColor); layers.push(color); if (color[3] === 1) { opaque = true; break; }
    }
    if (!opaque) throw Error('NODE_PROPERTY_FIXTURE_CONTRAST_BACKDROP_REQUIRED');
    let backdrop: Rgb = [255, 255, 255]; for (const layer of layers.reverse()) backdrop = blend(layer, backdrop);
    const own = getComputedStyle(element); if (own.filter !== 'none' || own.mixBlendMode !== 'normal' || own.backgroundImage !== 'none') throw Error('NODE_PROPERTY_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
    const background = blend(rgba(own.backgroundColor), backdrop), ownOpacity = Number(own.opacity);
    const text = isPlaceholder ? getComputedStyle(element, '::placeholder') : own;
    const paint = rgba(text.color); if (isPlaceholder) paint[3] *= Number(text.opacity);
    return ratio(blend([...blend(paint, background), ownOpacity], backdrop), blend([...background, ownOpacity], backdrop));
  }, placeholder);
}


describe('node property visual contrast',()=>{it.each(THEMES)('%s keeps the danger action readable without triggering deletion',async theme=>{await withSession(theme,320,640,{nodeType:'input-param'},async s=>{const p=await selectNode(s),button=p.getByRole('button',{name:'删除节点',exact:true});await propertyTarget(s,button);const before=JSON.stringify(await workflow(s));const normal=await textContrast(button);await button.hover();await settle(s.page);const hover=await textContrast(button);console.log('NODE_PROPERTY_DANGER_CONTRAST',JSON.stringify({theme,normal,hover}));expect(Math.min(normal,hover),'property danger text contrast').toBeGreaterThanOrEqual(4.5);expect(JSON.stringify(await workflow(s))).toBe(before);});},25000);});
describe('node property contrast guard',()=>{
 it('treats transparent danger text as invisible',async()=>{await withSession('gold',390,844,{},async s=>{const p=await selectNode(s),button=p.getByRole('button',{name:'删除节点',exact:true});await propertyTarget(s,button);await button.evaluate(e=>{e.style.color='transparent';});await expect.poll(()=>button.evaluate(e=>getComputedStyle(e).color),{timeout:1500}).toBe('rgba(0, 0, 0, 0)');expect(await textContrast(button)).toBe(1);});},25000);
 it('refuses an unsupported backdrop rather than inventing a passing ratio',async()=>{await withSession('gold',390,844,{},async s=>{const p=await selectNode(s),button=p.getByRole('button',{name:'删除节点',exact:true});await propertyTarget(s,button);await button.evaluate(e=>{e.parentElement!.style.backgroundImage='linear-gradient(red,blue)';});await expect(textContrast(button)).rejects.toThrow('NODE_PROPERTY_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');});},25000);
});
