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
import { createBriefToVideoSkill } from '@/lib/skill-runtime/brief-to-video-preset';

type Theme = 'gold' | 'mono';
interface Options { asset?: 'allow' | 'deny' | 'scope'; nodeType?: NodeType; config?: Record<string, unknown>; modelFixtures?: boolean }
interface FixtureWindow extends Window { nodeProperty: { mount(theme: Theme, options: Options): void; unmount(): void; state: { workflow: Workflow | null; disposed: boolean } } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean; canonicalUrl: string | null }
const ORIGIN = 'https://node-brief-capability-followup.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import NodeEditor from '@/components/node-editor';
import {createEmptyWorkflow,createWorkflowNode,type Workflow} from '@/lib/workflow-engine';
import type {TaskModelDescriptor} from '@/lib/task-core/model-capability-contract';
import type {TaskModelCatalogModel} from '@/hooks/use-task-model-catalog';
const offlineModelCatalog:TaskModelDescriptor[]=[
 {providerId:'qt-planner',modelId:'qt-planner-model',kind:'chat',sourceType:'chat',protocol:'chat-completions',executionMode:'sync',supportsVision:true,allowedRatios:[],allowedSizes:[],qualityOptions:[],maxOutputs:1,supportsReferenceImages:false,supportsMask:false,outputKinds:['text'],capabilitySources:{}},
 {providerId:'qt-video-a',modelId:'shared-video-model',kind:'video',sourceType:'video',protocol:'apimart-video',executionMode:'async',allowedRatios:['16:9'],allowedSizes:['720p'],qualityOptions:['std'],maxOutputs:1,supportsReferenceImages:true,maxReferenceImages:2,supportsMask:false,allowedDurationsSeconds:[5,10],maxDurationSeconds:10,supportedOperations:['text-to-video','image-to-video','first-last-frame'],outputKinds:['mp4'],capabilitySources:{}},
 {providerId:'qt-video-b',modelId:'shared-video-model',kind:'video',sourceType:'video',protocol:'apimart-video',executionMode:'async',allowedRatios:['9:16'],allowedSizes:['1080p'],qualityOptions:['std'],maxOutputs:1,supportsReferenceImages:true,maxReferenceImages:2,supportsMask:false,allowedDurationsSeconds:[6,12],maxDurationSeconds:12,supportedOperations:['text-to-video','image-to-video','first-last-frame'],outputKinds:['mp4'],capabilitySources:{}}
];
const offlineModelOptions:TaskModelCatalogModel[]=[
 {id:'qt-planner-model',name:'隔离规划模型',type:'chat',providerId:'qt-planner',providerName:'隔离规划供应商'},
 {id:'shared-video-model',name:'同名视频模型',type:'video',providerId:'qt-video-a',providerName:'隔离视频供应商甲'},
 {id:'shared-video-model',name:'同名视频模型',type:'video',providerId:'qt-video-b',providerName:'隔离视频供应商乙'}
];
const root=createRoot(document.getElementById('fixture-root')!);
const state={workflow:null as Workflow|null,disposed:false};let mounted=false;
Object.assign(window,{nodeProperty:{state,mount(theme:'gold'|'mono',options:{config?:Record<string,unknown>}){
 if(mounted||state.disposed)throw Error('NODE_PROPERTY_FIXTURE_REMOUNT');mounted=true;
 const workflow={...createEmptyWorkflow('隔离 Brief 视频能力验收'),id:'qt-brief-capability-workflow'};
 const node=createWorkflowNode('ai-skill',40,60,'离线属性节点');node.config={...node.config,...options.config};workflow.nodes=[node];
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');
 root.render(<NodeEditor taskModelCatalog={offlineModelCatalog} taskModelOptions={offlineModelOptions} catalogStatus={{loading:false,error:null}}
 workflow={workflow} userId="ui-node-actor" projectId="ui-node-project" canvasDocumentMode themeStyle={theme==='mono'?'monochrome':'gold'} canvasImages={[]}
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
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'node-brief-capability-followup-entry.tsx' } });
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
  if (!browser) throw Error('NODE_PROPERTY_FIXTURE_BROWSER_REQUIRED'); const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' }); contexts.add(context); let value: Session | undefined;
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
        if (key === 'GET /api/skills?surface=workflow' && request.postData() === null) { await route.fulfill({ json: { skills: [createBriefToVideoSkill(true)] } }); return; }
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
async function capture(s: Session, name: string): Promise<void> { const directory=path.resolve('output/playwright/node-brief-capability-followup-20261025',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('NODE_PROPERTY_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false})); }

function properties(s:Session):Locator{return s.page.getByText('节点属性',{exact:true}).locator('../..');}
function propertyScroll(s:Session):Locator{return properties(s).locator(':scope > div').last();}
async function selectNode(s:Session):Promise<Locator>{const entry=s.page.getByRole('button',{name:'切换节点库面板',exact:true});if(await entry.getAttribute('aria-pressed')==='true'){await reveal(s,toolbar(s),entry,true);await entry.tap();await settle(s.page);}const card=s.page.locator('[data-node-id][aria-label="离线属性节点"]');await card.waitFor();await card.tap({position:{x:15,y:15}});await settle(s.page);await properties(s).getByRole('button',{name:'关闭节点属性',exact:true}).waitFor();return properties(s);}
async function propertyTarget(s:Session,control:Locator):Promise<void>{await reveal(s,propertyScroll(s),control);await target(control);}
async function inputSize(control:Locator):Promise<void>{expect(await control.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize)),'property input text size').toBeGreaterThanOrEqual(16);}


interface VideoCase {
  providerId: 'qt-video-a' | 'qt-video-b';
  durations: readonly string[];
  ratios: readonly string[];
  resolutions: readonly string[];
  choice: { duration: string; ratio: string; resolution: string };
}
const VIDEO_CASES: readonly VideoCase[] = [
  { providerId: 'qt-video-a', durations: ['5', '10'], ratios: ['16:9'], resolutions: ['720p'],
    choice: { duration: '10', ratio: '16:9', resolution: '720p' } },
  { providerId: 'qt-video-b', durations: ['6', '12'], ratios: ['9:16'], resolutions: ['1080p'],
    choice: { duration: '12', ratio: '9:16', resolution: '1080p' } },
];
async function selectableValues(control: Locator): Promise<string[]> {
  return control.locator('option').evaluateAll(options => options
    .map(element => (element as HTMLOptionElement).value)
    .filter(value => value !== ''));
}
async function choose(s: Session, control: Locator, value: string): Promise<void> {
  await propertyTarget(s, control);
  await inputSize(control);
  await control.selectOption(value);
  await settle(s.page);
}
describe('QT real NodeEditor Brief video capability binding', () => {
  it.each(THEMES.flatMap(theme => VIDEO_CASES.map(video => ({ theme, video }))))(
    '$theme keeps $video.providerId capabilities and selected values for the exact same-named video model',
    async ({ theme, video }) => {
      const width = theme === 'gold' ? 320 : 390;
      const height = theme === 'gold' ? 640 : 844;
      await withSession(theme, width, height, { nodeType: 'ai-skill' }, async s => {
        const panel = await selectNode(s);
        await choose(s, panel.getByRole('combobox', { name: 'Skill', exact: true }), 'preset-brief-to-video-film');
        const brief = panel.getByLabel('创作 Brief', { exact: true });
        await propertyTarget(s, brief);
        await brief.fill('只验证隔离表单的能力与配置回写');
        await settle(s.page);
        await choose(s, panel.getByRole('combobox', { name: 'video 模型', exact: true }),
          video.providerId + '::shared-video-model');
        const modelBindings = (await workflow(s)).nodes[0].config.modelBindings;
        expect(modelBindings, 'QT_EXACT_VIDEO_BINDING_COMMITTED_BEFORE_CAPABILITY_CHECK').toMatchObject({
          video: { providerId: video.providerId, modelId: 'shared-video-model' },
        });
        const duration = panel.getByRole('combobox', { name: '视频时长', exact: true });
        const ratio = panel.getByRole('combobox', { name: '画面比例', exact: true });
        const resolution = panel.getByRole('combobox', { name: '分辨率', exact: true });
        await propertyTarget(s, duration);
        await capture(s, 'qt-brief-' + theme + '-' + video.providerId + '-before-capability-assertion');
        console.log('QT_BRIEF_CAPABILITY_OPTIONS', JSON.stringify({
          theme, width, height, providerId: video.providerId,
          modelBindings,
          durationOptions: await selectableValues(duration),
          ratioOptions: await selectableValues(ratio),
          resolutionOptions: await selectableValues(resolution),
          inputMethods: ['native-card-tap', 'native-wheel-reveal', 'public-selectOption'],
          physicalTouch: false, cloud: false,
        }));
        expect(await selectableValues(duration), 'exact bound video duration choices').toEqual(video.durations);
        expect(await selectableValues(ratio), 'exact bound video ratio choices').toEqual(video.ratios);
        expect(await selectableValues(resolution), 'exact bound video resolution choices').toEqual(video.resolutions);
        await choose(s, duration, video.choice.duration);
        await choose(s, ratio, video.choice.ratio);
        await choose(s, resolution, video.choice.resolution);
        const current = await workflow(s);
        expect(current.nodes[0].config.inputValues).toMatchObject({
          brief: '只验证隔离表单的能力与配置回写',
          durationSeconds: video.choice.duration,
          aspectRatio: video.choice.ratio,
          resolution: video.choice.resolution,
        });
        await capture(s, 'qt-brief-' + theme + '-' + video.providerId + '-selected');
      });
    }, 25000);
  it.each(THEMES)(
    '%s never borrows capability options from another provider when a saved exact binding is unavailable',
    async theme => {
      const width = theme === 'gold' ? 320 : 390;
      const height = theme === 'gold' ? 640 : 844;
      await withSession(theme, width, height, { nodeType: 'ai-skill', config: {
        skillId: 'preset-brief-to-video-film', version: 1,
        modelBindings: { video: { providerId: 'qt-retired-video', modelId: 'shared-video-model' } },
      } }, async s => {
        const panel = await selectNode(s);
        const duration = panel.getByRole('combobox', { name: '视频时长', exact: true });
        const ratio = panel.getByRole('combobox', { name: '画面比例', exact: true });
        const resolution = panel.getByRole('combobox', { name: '分辨率', exact: true });
        for (const control of [duration, ratio, resolution]) {
          await propertyTarget(s, control);
          await inputSize(control);
          expect(await selectableValues(control), 'unavailable exact binding stays closed').toEqual([]);
        }
        expect((await workflow(s)).nodes[0].config.modelBindings).toMatchObject({
          video: { providerId: 'qt-retired-video', modelId: 'shared-video-model' },
        });
        await capture(s, 'qt-brief-' + theme + '-unavailable-exact-binding');
      });
    }, 25000);
});
