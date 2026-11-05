// @vitest-environment node
// Real InfiniteCanvas consumer and shipped CSS in Chromium. Only read-only
// startup HTTP responses are local. No private state or paid model calls.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
interface FixtureWindow extends Window {
  ompMobile: { png: string; mount(theme: Theme, synthetic?: boolean, external?: boolean): void; unmount(): void; stopTaskEvents(): void; visual(view:{width:number;height:number;left:number;top:number}):void; state: { mounts: number; closes: number; inserts: string[]; disposed: boolean; images: unknown[]; view:{offsetX:number;offsetY:number;zoom:number}|null; events: Array<{type:string;target:string}> } };
}
interface Session {
  context: BrowserContext; page: Page; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; mounted: boolean;
  pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; responseStatus: Map<Request,number>; nativeWaiters: Set<() => void>; png: Buffer;
}
const ORIGIN = 'https://oh-my-prompt-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InfiniteCanvas,type CanvasImage} from '@/components/infinite-canvas';
import OhMyPrompt from '@/components/oh-my-prompt';
import {taskEventsClient} from '@/lib/task-events-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;
const ctx=picture.getContext('2d');if(!ctx)throw Error('OMP_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const source={id:'omp-source',url:png,x:180,y:180,width:96,height:96,originalWidth:64,originalHeight:64,prompt:'离线来源',assetVersionId:'omp-source-version',createdAt:1,zIndex:1};
const state={mounts:0,closes:0,inserts:[] as string[],disposed:false,images:[] as CanvasImage[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const observeView=(view:{offsetX:number;offsetY:number;zoom:number})=>{state.view=view;};
let syntheticViewport:(EventTarget&{width:number;height:number;offsetLeft:number;offsetTop:number;scale:number})|undefined;
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.tagName||'unknown'});};
function Entry({theme,external}:{theme:'gold'|'mono';external:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([source]);const [selected,setSelected]=useState<CanvasImage|null>(null);const [open,setOpen]=useState(false);state.images=images;
 return <><InfiniteCanvas renderOhMyPromptExternally={external} images={images} selectedImage={selected} projectId="omp-mobile-project" isPanelCollapsed
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}}
 onViewStateChange={observeView}
 ohMyPromptOpen={open} onToggleVisionPrompt={()=>setOpen(v=>!v)} onCloseOhMyPrompt={()=>{state.closes++;setOpen(false)}}
 ohMyPromptThemeStyle={theme==='mono'?'default':'gold'} onInsertPrompt={p=>state.inserts.push(p)}
 onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={()=>{}} onGenerateVariation={()=>{}}
 onExtractKeywords={()=>{}} onFusion={()=>{}} onAddImages={()=>{throw Error('OMP_FIXTURE_UNEXPECTED_PUBLISH')}}/>{external&&open&&<OhMyPrompt isOpen floating onClose={()=>{state.closes++;setOpen(false)}} onInsertPrompt={p=>state.inserts.push(p)}/>}</>;
}
Object.assign(window,{ompMobile:{state,png,mount(theme:'gold'|'mono',synthetic=false,external=false){
 if(state.mounts||state.disposed)throw Error('OMP_FIXTURE_REMOUNT');state.mounts++;
 if(synthetic){syntheticViewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:syntheticViewport});}
 document.addEventListener('gotpointercapture',observe,true);document.addEventListener('click',observe,true);
 document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} external={external}/>);
},stopTaskEvents(){taskEventsClient.disconnect();},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();document.removeEventListener('gotpointercapture',observe,true);document.removeEventListener('click',observe,true);},visual(view:{width:number;height:number;left:number;top:number}){if(!syntheticViewport)throw Error('OMP_FIXTURE_SYNTHETIC_VIEWPORT_REQUIRED');Object.assign(syntheticViewport,{width:view.width,height:view.height,offsetLeft:view.left,offsetTop:view.top});syntheticViewport.dispatchEvent(new Event('resize'));syntheticViewport.dispatchEvent(new Event('scroll'));}}});
`;

let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  // Same native loader and exact installed Next/ag-psd browser boundaries as the
  // reviewed additional-tools-b aspect host. No component or hook replacements.
  if (typeof process.getBuiltinModule !== 'function') throw Error('OMP_FIXTURE_NATIVE_LOADER_REQUIRED');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const result = await build({ write: false, bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
    absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' },
    inject: ['task5-next-client-process'],
    plugins: [{ name: 'next-official-browser-variants', setup(builder: import('esbuild').PluginBuild): void {
      const browserVariants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
      const variants = new Map(browserVariants.browserVariantModules.map(id => [
        require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`),
      ]));
      const frameworkFilter = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
      builder.onResolve({ filter: new NativeRegExp('^task5-next-client-process$') }, () => ({ path: 'task5-next-client-process', namespace: 'task5-framework-host' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'task5-framework-host' }, () => ({
        contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd(),
      }));
      const utilImporters = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && utilImporters.has(path.resolve(args.importer))
        ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(frameworkFilter.source, frameworkFilter.flags) }, args => {
        if (!args.importer) return undefined;
        const actual = createRequire(args.importer).resolve(args.path), browserFile = variants.get(actual);
        return browserFile ? { path: browserFile } : undefined;
      });
    } }],
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'oh-my-prompt-mobile-entry.tsx' },
  });
  if (result.outputFiles.length !== 1) throw Error('OMP_FIXTURE_MEMORY_BUNDLE_REQUIRED');
  bundle = result.outputFiles[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) })));
  sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile(path.resolve('src/app/globals.css'), 'utf8'), { base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css')
        : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css')
          : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    } });
  css = compiler.build(new Scanner({}).scanFiles(sources));
  browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://invalid.invalid:9', '--disable-background-networking', '--disable-component-update'] });
}, 30000);

afterAll(async () => {
  const errors: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { errors.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { errors.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; }
  if (errors.length) throw Error(errors.join('\n'));
}, 15000);

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function bounded(name: string, operation: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('OMP_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function session(theme: Theme, width: number, height: number, synthetic = false, external = false): Promise<Session> {
  if (!browser) throw Error('OMP_FIXTURE_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0) }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('response', response => s.responseStatus.set(response.request(),response.status()));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('OMP_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('OMP_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('OMP_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > (['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:1)) throw Error('OMP_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:503,json:{success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE'} });return; }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('OMP_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    s.png=Buffer.from((await page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.png)).split(',')[1],'base64');
    await page.evaluate(v => (window as unknown as FixtureWindow).ompMobile.mount(v.theme,v.synthetic,v.external), {theme,synthetic,external}); s.mounted = true;
    await page.locator('[data-canvas-viewport]').waitFor();
    await page.getByRole('button',{name:/^Oh My Prompt(?: - 提示词管理与图片识词)?$/}).first().click();
    const title = page.getByRole('heading',{name:'灵感工坊',exact:true}); await (external ? title.first() : title).waitFor(); await settle(page);
    return s;
  } catch (error) {
    try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'OMP_FIXTURE_BOOTSTRAP'); }
    throw error;
  }
}
async function nativeRequestsFinished(s: Session): Promise<void> {
  let notify: (() => void) | undefined;
  try {
    await bounded('native requests', () => new Promise<void>(resolve => {
      notify = () => { if (s.pending.size === 0) resolve(); }; s.nativeWaiters.add(notify); notify();
    }));
  } finally { if (notify) s.nativeWaiters.delete(notify); }
}
async function dispose(s: Session, expectedRefusal?: 'http' | 'websocket', cleanupProbe?: () => void): Promise<void> {
  const failures: string[] = [];
  try {
    if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).ompMobile.unmount()));
    cleanupProbe?.(); // Used only by the cleanup-fault selftest, after real unmount.
  } catch (error) { failures.push(String(error)); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  try { await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const unresolvedBeforeClose = s.pending.size !== 0 || s.handlers.size !== 0;
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  // Cleanup/lifecycle/allowlist failures can never share the expected-refusal
  // prefix. A boundary selftest must not succeed merely because close failed.
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png'];
  const keys=[...s.counts.keys()];
  if(s.counts.get('/')!==1 || keys.some(k=>!allowed.includes(k)&&!(expectedRefusal==='http'&&k==='/unexpected'))){
    console.log('OMP_FIXTURE_REQUEST_DIAGNOSTIC',JSON.stringify({counts:[...s.counts],errors:s.errors}));
    throw Error('OMP_FIXTURE_REQUEST_VALIDATION');
  }
  const completed=[...s.completed].map(r=>r.url());
  const expectedCompleted=[...s.counts].filter(([k])=>k!=='/unexpected').flatMap(([k,n])=>Array.from({length:n},()=>ORIGIN+k));
  const failed=[...s.failed];
  const validFailures=expectedRefusal==='http'?failed.length===1&&failed[0].url()===ORIGIN+'/unexpected'&&s.refused.has(failed[0]):failed.length===0;
  if(unresolvedBeforeClose||s.pending.size||!validFailures||JSON.stringify(completed.sort())!==JSON.stringify(expectedCompleted.sort())){
    console.log('OMP_NATIVE_REQUEST_FAILURE_DIAGNOSTIC',JSON.stringify({unresolvedBeforeClose,pending:[...s.pending].map(r=>r.url()),completed,expectedCompleted,failed:failed.map(r=>({url:r.url(),error:r.failure()?.errorText,status:s.responseStatus.get(r)}))}));
    throw Error('OMP_FIXTURE_NATIVE_REQUEST_FAILURE');
  }
  if (expectedRefusal) {
    const expected = expectedRefusal === 'http' ? 'Error: OMP_FIXTURE_UNKNOWN_HTTP /unexpected' : 'OMP_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('OMP_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (failures.length) throw Error('OMP_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (s.errors.length) throw Error('OMP_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}
async function withSession(theme: Theme, width: number, height: number, run: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(theme, width, height); try { await run(s); } finally { await dispose(s); }
}
function heading(s:Session):Locator{return s.page.getByRole('heading',{name:'灵感工坊',exact:true});}
function header(s:Session):Locator{return heading(s).locator('../..');}
function shell(s:Session):Locator{return header(s).locator('../..');}
function body(s:Session):Locator{return header(s).locator('..').locator(':scope > div').nth(2);}
function close(s:Session):Locator{return header(s).getByRole('button');}
function vision(s:Session):Locator{return shell(s).getByRole('button',{name:'识词',exact:true});}
async function target(control: Locator, minimum = 44): Promise<void> {
  const info = await control.evaluate(element => {
    const r = element.getBoundingClientRect(), own = getComputedStyle(element);
    let clear = own.visibility === 'visible' && Number(own.opacity) > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const b = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < b.left + parent.clientLeft - 0.5 || r.right > b.left + parent.clientLeft + parent.clientWidth + 0.5)) clear = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < b.top + parent.clientTop - 0.5 || r.bottom > b.top + parent.clientTop + parent.clientHeight + 0.5)) clear = false;
    }
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x: r.x, y: r.y, width: r.width, height: r.height, clear,
      hit: [[x, y], [r.left + 8, y], [r.right - 8, y], [x, r.top + 8], [x, r.bottom - 8]].every(([a, b]) => element.contains(document.elementFromPoint(a, b))) };
  });
  expect(info.clear, 'whole target visible ' + JSON.stringify(info)).toBe(true);
  expect(info.width, 'target width').toBeGreaterThanOrEqual(minimum); expect(info.height, 'target height').toBeGreaterThanOrEqual(minimum);
  expect(info.hit, 'native center and side hits').toBe(true);
}
async function nativeReveal(s: Session, scroll: Locator, control: Locator, horizontal = false): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const clip = await scroll.boundingBox(), r = await control.boundingBox(); if (!clip || !r) throw Error('OMP_FIXTURE_SCROLL_RECT');
    const start = horizontal ? r.x : r.y, size = horizontal ? r.width : r.height, bound = horizontal ? clip.x : clip.y, available = horizontal ? clip.width : clip.height;
    if (start >= bound + 1 && start + size <= bound + available - 1) return;
    expect(available, 'scroller fits target').toBeGreaterThanOrEqual(size + 2);
    const delta = start < bound + 1 ? Math.floor(start - bound - 2) : Math.ceil(start + size - bound - available + 2);
    await s.page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2); await s.page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta); await settle(s.page);
  }
  throw Error('OMP_FIXTURE_NATIVE_SCROLL_UNREACHED');
}
async function singleLine(control: Locator): Promise<void> {
  await target(control, 0);
  const text = await control.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops: number[] = []; let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || node.parentElement?.closest('svg')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      tops.push(...[...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)));
    }
    return { lines: new Set(tops).size, clipped: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(text.lines, 'horizontal title').toBe(1); expect(text.clipped, 'title not clipped').toBe(false);
}


async function capture(s:Session,theme:Theme,width:number,height:number):Promise<void>{
 const dir=path.resolve('output/playwright/mobile-omp-native-20261018',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,theme+'-'+width+'x'+height+'.png');await s.page.screenshot({path:file});console.log('OMP_NATIVE_CAPTURE',JSON.stringify({path:file,theme,width,height,physicalTouch:false}));
}
async function checkLayout(s:Session):Promise<void>{
 const r=await shell(s).boundingBox();expect(r!.x,'panel left margin').toBeGreaterThanOrEqual(8);expect(r!.y,'panel top margin').toBeGreaterThanOrEqual(8);
 expect(r!.x+r!.width,'panel right edge').toBeLessThanOrEqual(s.page.viewportSize()!.width-8);
 expect(r!.y+r!.height,'panel bottom edge').toBeLessThanOrEqual(s.page.viewportSize()!.height-8);
 await target(close(s));await target(vision(s));await target(shell(s).getByRole('button',{name:'AI增强',exact:true}));
 expect(await close(s).getAttribute('aria-label')).toBe('关闭灵感工坊');
 await singleLine(heading(s));await singleLine(vision(s));
 expect(await shell(s).evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no horizontal leak').toBe(true);
}
describe('mobile omp layout',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))
 ('$theme $width x $height keeps window and actions visible',async({theme,width,height})=>{await withSession(theme,width,height,async s=>{await capture(s,theme,width,height);await checkLayout(s);await vision(s).click();await settle(s.page);expect(await s.page.getByText('点击上传图片，AI自动识别关键词',{exact:true}).count()).toBe(1);await close(s).click();await settle(s.page);expect(await heading(s).count()).toBe(0);});},25000);
});
describe('omp canvas pointer',()=>{
 it.each(THEMES)('%s changes tabs and closes with native pointer clicks',async theme=>{await withSession(theme,390,844,async s=>{
  await vision(s).click();await settle(s.page);console.log('OMP_NATIVE_POINTER_TRACE',JSON.stringify(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.events)));
  expect(await s.page.getByText('点击上传图片，AI自动识别关键词',{exact:true}).count(),'vision tab responds to native click').toBe(1);
  await shell(s).getByRole('button',{name:'AI增强',exact:true}).click();await settle(s.page);expect(await s.page.getByPlaceholder('输入原始提示词...').count()).toBe(1);
  await close(s).click();await settle(s.page);expect(await heading(s).count(),'close responds to native click').toBe(0);
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.closes)).toBe(1);
 });},25000);
});
describe('omp mobile input',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[640,320]].map(([width,height])=>({theme,width,height}))))
 ('$theme $width x $height reaches all quick modes and input without touching the canvas',async({theme,width,height})=>{await withSession(theme,width,height,async s=>{
  const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.images);await checkLayout(s);
  await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.view),{timeout:1500}).toEqual({offsetX:0,offsetY:0,zoom:1});
  const sourceRect=await s.page.locator('[data-canvas-image-id="omp-source"]').boundingBox();
  const input=s.page.getByPlaceholder('输入原始提示词...');await nativeReveal(s,body(s),input);await target(input);await input.click();expect(await input.evaluate(e=>document.activeElement===e)).toBe(true);await s.page.keyboard.type('只检查输入，不请求优化');
  const send=input.locator('..').getByRole('button');await nativeReveal(s,body(s),send);await target(send);expect(await send.getAttribute('aria-label')).toBe('发送优化请求');
  for(const name of ['增强','扩展','精简','电影感','高细节']){const b=shell(s).getByRole('button',{name,exact:true});await nativeReveal(s,body(s),b);await target(b);}
  await nativeReveal(s,body(s),input);expect(await input.inputValue()).toBe('只检查输入，不请求优化');
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.images)).toEqual(before);
  expect(await s.page.locator('[data-canvas-image-id="omp-source"]').boundingBox()).toEqual(sourceRect);
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.view)).toEqual({offsetX:0,offsetY:0,zoom:1});
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.events.filter(e=>e.type==='gotpointercapture'&&e.target==='canvas').length)).toBe(0);
 });},25000);
});
describe('omp orientation and desktop',()=>{
 it.each(THEMES)('%s preserves the same input while rotating and on desktop',async theme=>{await withSession(theme,390,844,async s=>{
  const input=s.page.getByPlaceholder('输入原始提示词...');await input.fill('旋转保留草稿');
  for(const [width,height] of [[640,320],[320,640],[1440,900]]){await s.page.setViewportSize({width,height});await settle(s.page);await checkLayout(s);await nativeReveal(s,body(s),input);expect(await input.inputValue()).toBe('旋转保留草稿');}
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.mounts)).toBe(1);
 });},25000);
});
describe('omp visible viewport',()=>{
 it.each(THEMES)('%s stays inside a shortened offset viewport without remounting',async theme=>{
  const s=await session(theme,390,844,true);try{
   const input=s.page.getByPlaceholder('输入原始提示词...');await input.fill('键盘区域草稿');
   await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.visual({width:370,height:320,left:10,top:120}));await settle(s.page);
   const observedAt=Date.now();
   await s.page.waitForFunction(()=>{const title=[...document.querySelectorAll('h2')].find(e=>e.textContent==='灵感工坊');const panel=title?.parentElement?.parentElement?.parentElement?.parentElement;if(!panel)return false;const r=panel.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=18&&r.top>=128&&r.right<=372&&r.bottom<=432;});
   const r=await shell(s).evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
   const native=await shell(s).evaluate(element=>{const r=element.getBoundingClientRect(),style=getComputedStyle(element);return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},inline:(element as HTMLElement).style.cssText,computed:{left:style.left,top:style.top,width:style.width,height:style.height,transform:style.transform,transition:style.transition}};});
   console.log('OMP_VIEWPORT_RENDER_READY',JSON.stringify({rect:r,native,elapsedMs:Date.now()-observedAt}));
   expect(r!.x,'visible left bound').toBeGreaterThanOrEqual(18);expect(r!.y,'visible top bound').toBeGreaterThanOrEqual(128);
   expect(r!.x+r!.width,'visible right bound').toBeLessThanOrEqual(372);expect(r!.y+r!.height,'visible bottom bound').toBeLessThanOrEqual(432);
   await target(close(s));await nativeReveal(s,body(s),input);await target(input);expect(await input.inputValue()).toBe('键盘区域草稿');
   expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.mounts)).toBe(1);
  }finally{await dispose(s);}
 },25000);
});
describe('omp initial scroll',()=>{
 it.each(THEMES)('%s does not scroll away the empty quick-mode heading on opening',async theme=>{
  await withSession(theme,320,640,async s=>{await settle(s.page);expect(await body(s).evaluate(e=>e.scrollTop),'initial body scroll').toBe(0);});
 },25000);
});
interface QuickModeContrastSample { foreground:string; background:string; opacity:number; iconStroke:string; visibleText:[number,number,number]; visibleBackground:[number,number,number]; textContrast:number; iconContrast:number }
async function quickModeContrast(button:Locator):Promise<QuickModeContrastSample>{
 return button.evaluate(element=>{
     const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('OMP_FIXTURE_CONTRAST_CANVAS');
     type Rgba=[number,number,number,number];type Rgb=[number,number,number];
     const rgba=(value:string):Rgba=>{if(!CSS.supports('color',value)||/^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value))throw Error('OMP_FIXTURE_CONTRAST_COLOR_NOT_PAINTABLE');ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;return[d[0],d[1],d[2],d[3]/255];};
     const blend=(front:Rgba,back:Rgb):Rgb=>[0,1,2].map(i=>front[i]*front[3]+back[i]*(1-front[3])) as Rgb;
     const luminance=(rgb:Rgb):number=>rgb.map(v=>{const n=v/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
     const contrast=(a:Rgb,b:Rgb):number=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
     if(contrast([255,255,255],[255,255,255])!==1||Math.abs(contrast([0,0,0],[255,255,255])-21)>0.000001)throw Error('OMP_FIXTURE_CONTRAST_CANARY');
     const layers:Rgba[]=[];let opaque=false;
     for(let p=element.parentElement;p;p=p.parentElement){const st=getComputedStyle(p);if(Number(st.opacity)!==1||st.filter!=='none'||st.mixBlendMode!=='normal'||st.backgroundImage!=='none')throw Error('OMP_FIXTURE_CONTRAST_UNSUPPORTED_COMPOSITE');const color=rgba(st.backgroundColor);layers.push(color);if(color[3]===1){opaque=true;break;}}
     if(!opaque)throw Error('OMP_FIXTURE_CONTRAST_BACKDROP_REQUIRED');let backdrop:Rgb=[255,255,255];for(const layer of layers.reverse())backdrop=blend(layer,backdrop);
     const style=getComputedStyle(element),opacity=Number(style.opacity),background=blend(rgba(style.backgroundColor),backdrop);
     if(style.filter!=='none'||style.mixBlendMode!=='normal'||style.backgroundImage!=='none')throw Error('OMP_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
     const visibleBackground=blend([...background,opacity],backdrop),visibleText=blend([...blend(rgba(style.color),background),opacity],backdrop);
     const svg=element.querySelector('svg');if(!svg)throw Error('OMP_FIXTURE_CONTRAST_ICON_REQUIRED');const icon=getComputedStyle(svg);
     const strokeOpacity=Number(icon.strokeOpacity),iconOpacity=Number(icon.opacity);if(!Number.isFinite(strokeOpacity)||strokeOpacity<0||strokeOpacity>1||!Number.isFinite(iconOpacity)||iconOpacity<0||iconOpacity>1)throw Error('OMP_FIXTURE_CONTRAST_ICON_OPACITY');
     const stroke=rgba(icon.stroke);stroke[3]*=strokeOpacity*iconOpacity;const visibleIcon=blend([...blend(stroke,background),opacity],backdrop);
     return{foreground:style.color,background:style.backgroundColor,opacity,iconStroke:icon.stroke,visibleText,visibleBackground,textContrast:contrast(visibleText,visibleBackground),iconContrast:contrast(visibleIcon,visibleBackground)};
    });
}
describe('omp quick mode contrast',()=>{
 it.each(THEMES.flatMap(theme=>[320,640].flatMap(width=>[false,true].map(enabled=>({theme,width,height:width===320?640:320,enabled})))))
 ('$theme $width enabled=$enabled keeps labels and icons readable without hover',async({theme,width,height,enabled})=>{
  await withSession(theme,width,height,async s=>{
   if(enabled){const input=s.page.getByPlaceholder('输入原始提示词...');await nativeReveal(s,body(s),input);await input.click();await s.page.keyboard.type('仅启用按钮，不提交');}
   const samples:unknown[]=[];
   for(const name of ['增强','扩展','精简','电影感','高细节']){
    const button=shell(s).getByRole('button',{name,exact:true});await nativeReveal(s,body(s),button);await s.page.mouse.move(0,0);await settle(s.page);
    expect(await button.isDisabled()).toBe(!enabled);expect(await button.evaluate(e=>e.matches(':hover'))).toBe(false);
    const colors=await quickModeContrast(button);samples.push({name,...colors});console.log('OMP_QUICK_MODE_COMPUTED_CONTRAST',JSON.stringify({theme,width,enabled,name,...colors}));
    expect(colors.textContrast,'quick mode text contrast').toBeGreaterThanOrEqual(4.5);expect(colors.iconContrast,'quick mode icon contrast').toBeGreaterThanOrEqual(3);
   }
   expect(samples).toHaveLength(5);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).ompMobile.state.inserts)).toEqual([]);
  });
 },25000);
});
describe('omp contrast measurement',()=>{
 it.each(['none','transparent'] as const)('cannot classify %s SVG stroke as a visible high-contrast icon',async fault=>{
  await withSession('gold',390,844,async s=>{
   const button=shell(s).getByRole('button',{name:'增强',exact:true}),svg=button.locator('svg');
   // Negative measurement fixture only: no product geometry, behavior or positive case changes.
   await svg.evaluate((e,value)=>{if(value==='none')(e as SVGElement).style.stroke='none';else(e as SVGElement).style.strokeOpacity='0';},fault);
   if(fault==='transparent')await expect.poll(()=>svg.evaluate(e=>getComputedStyle(e).strokeOpacity),{timeout:1500}).toBe('0');
   if(fault==='none')await expect(quickModeContrast(button)).rejects.toThrow('OMP_FIXTURE_CONTRAST_COLOR_NOT_PAINTABLE');
   else{const value=await quickModeContrast(button);expect(value.iconContrast).toBe(1);expect(value.iconContrast).toBeLessThan(3);}
  });
 },25000);
});

describe('omp fixture boundary', () => {
  it.each(['http', 'websocket'] as const)('refuses %s and classifies it as infrastructure', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') expect(await s.page.evaluate(async () => { try { await fetch('/unexpected'); return false; } catch { return true; } })).toBe(true);
      else expect(await s.page.evaluate(() => new Promise<number>((resolve, reject) => {
        const socket = new WebSocket('wss://unexpected.invalid/'); const timer = setTimeout(() => reject(Error('OMP_FIXTURE_WS_NOT_REFUSED')), 3000);
        socket.onclose = event => { clearTimeout(timer); resolve(event.code); };
      }))).toBe(1008);
      let failure: unknown; try { await dispose(s, transport); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error); expect((failure as Error).name).toBe('Error');
      expect((failure as Error).message).toBe(transport === 'http'
        ? 'OMP_FIXTURE_INFRASTRUCTURE: Error: OMP_FIXTURE_UNKNOWN_HTTP /unexpected'
        : 'OMP_FIXTURE_INFRASTRUCTURE: OMP_FIXTURE_UNKNOWN_WS');
    } finally { if (live.has(s)) { await s.context.close(); contexts.delete(s.context); live.delete(s); } }
  }, 25000);
});

describe('omp fixture cleanup isolation', () => {
  it.each(['http', 'websocket'] as const)('cannot absorb a cleanup fault into expected %s refusal', async transport => {
    const s = await session('gold', 390, 844);
    try {
      if (transport === 'http') await s.page.evaluate(async () => { try { await fetch('/unexpected'); } catch { /* expected refusal */ } });
      else await s.page.evaluate(() => new Promise<void>((resolve, reject) => {
        const socket = new WebSocket('wss://unexpected.invalid/'); const timer = setTimeout(() => reject(Error('OMP_FIXTURE_WS_NOT_REFUSED')), 3000);
        socket.onclose = () => { clearTimeout(timer); resolve(); };
      }));
      let failure: unknown;
      try { await dispose(s, transport, () => { throw Error('OMP_FIXTURE_INJECTED_CLEANUP'); }); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('OMP_FIXTURE_CLEANUP_FAILURE: Error: OMP_FIXTURE_INJECTED_CLEANUP');
      expect(live.has(s)).toBe(false); expect(contexts.has(s.context)).toBe(false);
    } finally { if (live.has(s)) { await s.context.close(); contexts.delete(s.context); live.delete(s); } }
  }, 25000);
});


async function settleStartupTaskEvents(s: Session): Promise<void> {
  await expect.poll(() => s.counts.get('/api/task-events') ?? 0, { timeout: 1500 }).toBeGreaterThan(0);
  await bounded('startup routes', () => Promise.all([...s.handlers]));
  await nativeRequestsFinished(s);
  await s.page.evaluate(() => (window as unknown as FixtureWindow).ompMobile.stopTaskEvents());
}

describe('vision workbench ownership', () => {
  it.each([false, true])('renders exactly one workbench with external=%s', async external => {
    const s = await session('gold', 320, 640, false, external);
    try {
      expect(await s.page.locator('[data-floating-panel="oh-my-prompt"]').count()).toBe(1);
      await settleStartupTaskEvents(s);
    } finally { await dispose(s); }
  }, 25000);

  it('still rejects an unexpected failed task-events request', async () => {
    const s = await session('gold', 320, 640);
    try {
      await settleStartupTaskEvents(s);
      expect(s.failed.size).toBe(0);
      await s.context.route(ORIGIN + '/api/task-events', route => route.abort('failed'));
      expect(await s.page.evaluate(async () => { try { await fetch('/api/task-events'); return false; } catch { return true; } })).toBe(true);
      await nativeRequestsFinished(s);
      expect([...s.failed].map(request => request.url())).toEqual([ORIGIN + '/api/task-events']);
      await expect(dispose(s)).rejects.toThrow('OMP_FIXTURE_NATIVE_REQUEST_FAILURE');
    } finally { if (live.has(s)) await dispose(s); }
  }, 25000);
});
