// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, errors as playwrightErrors, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;images:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer}
const ORIGIN='https://canvas-shell-mobile.invalid';
const THEMES:readonly Theme[]=['gold','mono'];
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InfiniteCanvas,type CanvasImage} from '@/components/infinite-canvas';
import {TreeHistoryManager} from '@/lib/canvas-tree-history';
import {taskEventsClient} from '@/lib/task-events-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('CANVAS_UI_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const manager=new TreeHistoryManager();
const state={mounts:0,disposed:false,images:[] as CanvasImage[],actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
function Entry({theme,admin}:{theme:'gold'|'mono';admin:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;
 return <InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed isAdmin={admin}
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 versionHistoryManager={manager} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  // Same native loader and exact installed Next/ag-psd browser boundaries as the
  // reviewed additional-tools-b aspect host. No component or hook replacements.
  if (typeof process.getBuiltinModule !== 'function') throw Error('CANVAS_UI_FIXTURE_NATIVE_LOADER_REQUIRED');
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
  if (result.outputFiles.length !== 1) throw Error('CANVAS_UI_FIXTURE_MEMORY_BUNDLE_REQUIRED');
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
  browser = await chromium.launch({ headless: true });
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
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('CANVAS_UI_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function session(theme: Theme = 'gold', width: number = 390, height: number = 844, options: Options = {}): Promise<Session> {
  if (!browser) throw Error('CANVAS_UI_FIXTURE_BROWSER_REQUIRED');
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: options.touch===true, isMobile: options.touch===true }); contexts.add(context);
  let value: Session | undefined;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1500);
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0) }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('response', response => s.responseStatus.set(response.request(),response.status()));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('CANVAS_UI_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('CANVAS_UI_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > (['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:503,json:{success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE'} });return; }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    s.png=Buffer.from((await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.png)).split(',')[1],'base64');
    await page.evaluate(v => (window as unknown as FixtureWindow).canvasUi.mount(v.theme,v.options), {theme,options}); s.mounted = true;
    await page.locator('[data-canvas-viewport]').waitFor();
    await nativeRequestsFinished(s); await settle(page);
    await page.waitForFunction(()=>(window as unknown as FixtureWindow).canvasUi.state.view!==null,undefined,{timeout:1500});
    expect(await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view),'initial public canvas view').toEqual({offsetX:0,offsetY:0,zoom:1});
    return s;
  } catch (error) {
    try { if (value) await dispose(value); else { await context.close(); contexts.delete(context); } }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'CANVAS_UI_FIXTURE_BOOTSTRAP'); }
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
  const failures: unknown[] = [];
  try {
    if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).canvasUi.unmount()));
    cleanupProbe?.(); // Used only by the cleanup-fault selftest, after real unmount.
  } catch (error) { failures.push(error); }
  try { await bounded('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  try { await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const unresolvedBeforeClose = s.pending.size !== 0 || s.handlers.size !== 0;
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  // Cleanup/lifecycle/allowlist failures can never share the expected-refusal
  // prefix. A boundary selftest must not succeed merely because close failed.
  const invalid=(code:string):never=>{if(failures.length)throw new AggregateError([Error(code),...failures],'CANVAS_UI_FIXTURE_VALIDATION_AND_CLEANUP');throw Error(code);};
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
  const keys=[...s.counts.keys()];
  if(s.options.requireMissing || s.counts.get('/')!==1 || keys.some(k=>!allowed.includes(k)&&!(expectedRefusal==='http'&&k==='/unexpected'))){
    console.log('CANVAS_UI_FIXTURE_REQUEST_DIAGNOSTIC',JSON.stringify({counts:[...s.counts],errors:s.errors}));
    invalid('CANVAS_UI_FIXTURE_REQUEST_VALIDATION');
  }
  const completed=[...s.completed].map(r=>r.url());
  const expectedCompleted=[...s.counts].filter(([k])=>k!=='/unexpected').flatMap(([k,n])=>Array.from({length:n},()=>ORIGIN+k));
  const failed=[...s.failed];
  const validFailures=expectedRefusal==='http'?failed.length===1&&failed[0].url()===ORIGIN+'/unexpected'&&s.refused.has(failed[0]):failed.length===0;
  if(unresolvedBeforeClose||s.pending.size||!validFailures||JSON.stringify(completed.sort())!==JSON.stringify(expectedCompleted.sort())){
    console.log('CANVAS_UI_NATIVE_REQUEST_FAILURE_DIAGNOSTIC',JSON.stringify({unresolvedBeforeClose,pending:[...s.pending].map(r=>r.url()),completed,expectedCompleted,failed:failed.map(r=>({url:r.url(),error:r.failure()?.errorText,status:s.responseStatus.get(r)}))}));
    invalid('CANVAS_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
  }
  if (failures.length) throw Error('CANVAS_UI_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (expectedRefusal) {
    const expected = expectedRefusal === 'http' ? 'Error: CANVAS_UI_FIXTURE_UNKNOWN_HTTP /unexpected' : 'CANVAS_UI_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (s.errors.length) throw Error('CANVAS_UI_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}
function helpButton(s:Session):Locator{return s.page.locator('[data-canvas-empty-state]').getByRole('button',{name:'使用说明',exact:true});}
function helpPanel(s:Session):Locator{return s.page.locator('div.relative.rounded-2xl').filter({has:s.page.locator('span').filter({hasText:/^使用说明$/})});}
function helpClose(s:Session):Locator{return helpPanel(s).locator(':scope > div').first().getByRole('button');}
async function keyboardHelp(s:Session):Promise<void>{const b=helpButton(s);await b.focus();await b.press('Enter');await helpPanel(s).waitFor();await settle(s.page);await nativeRequestsFinished(s);}
async function trace(s:Session):Promise<void>{console.log('CANVAS_UI_POINTER_TRACE',JSON.stringify(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.events)));}
async function view(s:Session):Promise<unknown>{return s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view);}
async function target(control: Locator): Promise<void> {
  const value = await control.evaluate(e => { const r = e.getBoundingClientRect(); let clear = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let p = e.parentElement; p; p = p.parentElement) { const b = p.getBoundingClientRect(), s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && (r.left < b.left + p.clientLeft - 0.5 || r.right > b.left + p.clientLeft + p.clientWidth + 0.5)) clear = false; if (/(auto|scroll|hidden|clip)/.test(s.overflowY) && (r.top < b.top + p.clientTop - 0.5 || r.bottom > b.top + p.clientTop + p.clientHeight + 0.5)) clear = false; }
    const x = r.x + r.width / 2, y = r.y + r.height / 2; return { width: r.width, height: r.height, clear, hit: [[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b]) => e.contains(document.elementFromPoint(a,b))) }; });
  expect(value.width, 'target width').toBeGreaterThanOrEqual(44); expect(value.height, 'target height').toBeGreaterThanOrEqual(44); expect(value.clear, 'whole target visible').toBe(true); expect(value.hit, 'native hit').toBe(true);
}
describe('canvas shell help click',()=>{it.each(THEMES)('%s opens instructions with a normal pointer click',async theme=>{await withSession(theme,390,844,{},async s=>{await helpButton(s).click();await settle(s.page);await trace(s);expect(await helpPanel(s).count(),'help opens with native click').toBe(1);expect(await view(s)).toEqual({offsetX:0,offsetY:0,zoom:1});});},25000);});
describe('canvas shell help close',()=>{it.each(THEMES)('%s closes instructions with a normal pointer click',async theme=>{await withSession(theme,390,844,{},async s=>{await keyboardHelp(s);await helpClose(s).click();await settle(s.page);await trace(s);expect(await helpPanel(s).count(),'help closes with native click').toBe(0);expect(await view(s)).toEqual({offsetX:0,offsetY:0,zoom:1});});},25000);});

async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/canvas-shell-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('CANVAS_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}

describe('canvas shell help layout',()=>{it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps help and its close control inside the viewport',async({theme,width,height})=>{await withSession(theme,width,height,{},async s=>{await keyboardHelp(s);const r=await helpPanel(s).boundingBox();expect(r!.x,'help left margin').toBeGreaterThanOrEqual(8);expect(r!.y,'help top margin').toBeGreaterThanOrEqual(8);expect(r!.x+r!.width,'help right margin').toBeLessThanOrEqual(width-8);expect(r!.y+r!.height,'help bottom margin').toBeLessThanOrEqual(height-8);await target(helpClose(s));expect(await helpClose(s).getAttribute('aria-label'),'help close name').toBe('关闭画布帮助');expect(await helpPanel(s).evaluate(e=>e.scrollWidth<=e.clientWidth+1),'help does not leak horizontally').toBe(true);await capture(s,theme+'-help-'+width+'x'+height);if(width===390){await s.page.setViewportSize({width:1440,height:900});await settle(s.page);await target(helpClose(s));await capture(s,theme+'-help-desktop');}});},25000);});
describe('canvas shell empty targets',()=>{it.each(THEMES)('%s gives both empty actions complete touch targets',async theme=>{await withSession(theme,390,844,{},async s=>{const actions=s.page.locator('[data-canvas-empty-state]');expect(await actions.getByRole('button').count(),'exactly two empty actions').toBe(2);for(const name of ['上传图片','使用说明']){const b=actions.getByRole('button',{name,exact:true});expect(await b.count(),'expected named empty action '+name).toBe(1);await target(b);}});},25000);});
describe('canvas shell help scroll',()=>{it.each(THEMES)('%s scrolls instructions without panning the canvas',async theme=>{await withSession(theme,390,844,{},async s=>{await keyboardHelp(s);const scroll=helpPanel(s).locator(':scope > div').nth(1),r=await scroll.boundingBox();const before=await view(s);await s.page.mouse.move(r!.x+r!.width/2,r!.y+r!.height/2);await s.page.mouse.wheel(0,500);await expect.poll(()=>scroll.evaluate(e=>e.scrollTop),{timeout:1500}).toBeGreaterThan(0);await settle(s.page);expect(await view(s),'help scroll keeps canvas view').toEqual(before);});},25000);});
describe('canvas shell history empty',()=>{it.each(THEMES)('%s shows a zero empty count and a touch-sized close control',async theme=>{await withSession(theme,390,844,{},async s=>{await s.page.getByRole('button',{name:'全部工具',exact:true}).click();await s.page.getByRole('button',{name:'版本历史',exact:true}).click();const p=s.page.getByRole('dialog',{name:'版本历史',exact:true});await p.waitFor();console.log('CANVAS_UI_EMPTY_HISTORY',await p.innerText());expect(await p.getByText('可撤销 0 步',{exact:true}).count(),'empty undo count is zero').toBe(1);const close=p.getByRole('button',{name:'关闭版本历史',exact:true});await target(close);await s.page.setViewportSize({width:640,height:320});await settle(s.page);const geometry=await p.evaluate(e=>{const rect=(node:Element)=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};const panel=rect(e),header=rect(e.children[0]),footer=rect(e.children[2]),caption=rect([...e.querySelectorAll('span')].find(n=>n.textContent==='暂无历史记录')!);return {panel,header,footer,caption,good:header.top>=panel.top&&caption.top>=header.bottom&&caption.bottom<=footer.top&&footer.bottom<=panel.bottom};});console.log('CANVAS_UI_SHORT_HISTORY',JSON.stringify(geometry));expect(geometry.good,'short history content fits without overlap').toBe(true);await target(close);await close.click();await settle(s.page);expect(await p.count(),'history native close responds').toBe(0);});},25000);});

async function reveal(s:Session,scroll:Locator,control:Locator):Promise<void>{for(let i=0;i<8;i++){const b=await scroll.boundingBox(),r=await control.boundingBox();if(!b||!r)throw Error('CANVAS_UI_FIXTURE_SCROLL_RECT');if(r.y>=b.y+1&&r.y+r.height<=b.y+b.height-1)return;const delta=r.y<b.y+1?r.y-b.y-3:r.y+r.height-b.y-b.height+3;await s.page.mouse.move(b.x+b.width/2,b.y+b.height/2);await s.page.mouse.wheel(0,delta);await settle(s.page);}expect(false,'native navigation scroll reaches last action').toBe(true);}
describe('canvas shell nav collapsed',()=>{it.each(THEMES)('%s keeps collapsed navigation reachable above the mobile toolbar',async theme=>{await withSession(theme,640,320,{},async s=>{const scroll=s.page.locator('[data-toolbar="left-toolbar"] > div'),r=await scroll.boundingBox();expect(r!.y+r!.height,'navigation bottom reserve').toBeLessThanOrEqual(248);const b=scroll.getByRole('button',{name:'展开工具栏',exact:true});await reveal(s,scroll,b);await target(b);await capture(s,theme+'-navigation-collapsed');await b.click();await settle(s.page);expect(await s.page.locator('[data-toolbar="left-toolbar"]').getByText('无界AI',{exact:true}).count(),'native expand responds').toBe(1);expect(await view(s)).toEqual({offsetX:0,offsetY:0,zoom:1});});},25000);});
describe('canvas shell nav expanded',()=>{it.each(THEMES)('%s scrolls expanded navigation to the final collapse action',async theme=>{await withSession(theme,640,320,{admin:true},async s=>{const open=s.page.locator('[data-toolbar="left-toolbar"]').getByRole('button',{name:'展开工具栏',exact:true});await open.focus();await open.press('Enter');await settle(s.page);const scroll=s.page.locator('[data-toolbar="left-toolbar"] > div'),r=await scroll.boundingBox();expect(r!.y+r!.height,'expanded navigation bottom reserve').toBeLessThanOrEqual(248);const b=scroll.getByRole('button',{name:'收起',exact:true});await reveal(s,scroll,b);await target(b);await capture(s,theme+'-navigation-expanded');await b.click();await settle(s.page);expect(await s.page.locator('[data-toolbar="left-toolbar"]').getByText('无界AI',{exact:true}).count()).toBe(0);expect(await view(s)).toEqual({offsetX:0,offsetY:0,zoom:1});});},25000);});
describe('canvas shell fixture boundary',()=>{
  it('preserves request and cleanup faults together rather than losing either diagnostic',async()=>{
    const s=await session('gold',390,844,{requireMissing:true});let failure:unknown;try{await dispose(s,undefined,()=>{throw Error('CANVAS_UI_FIXTURE_INJECTED_CLEANUP');});}catch(e){failure=e;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors.map(String)).toEqual(['Error: CANVAS_UI_FIXTURE_REQUEST_VALIDATION','Error: CANVAS_UI_FIXTURE_INJECTED_CLEANUP']);expect(live.has(s)).toBe(false);
  },25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{
    const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* expected */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const socket=new WebSocket('wss://unexpected.invalid');const timer=setTimeout(()=>reject(Error('CANVAS_UI_FIXTURE_WS_TIMEOUT')),1500);socket.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'CANVAS_UI_FIXTURE_INFRASTRUCTURE: Error: CANVAS_UI_FIXTURE_UNKNOWN_HTTP /unexpected':'CANVAS_UI_FIXTURE_INFRASTRUCTURE: CANVAS_UI_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}
  },25000);
  it.each(['http','websocket'] as const)('cannot absorb cleanup failure into expected %s refusal',async transport=>{
    const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* expected */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const socket=new WebSocket('wss://unexpected.invalid');const timer=setTimeout(()=>reject(Error('CANVAS_UI_FIXTURE_WS_TIMEOUT')),1500);socket.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('CANVAS_UI_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('CANVAS_UI_FIXTURE_CLEANUP_FAILURE: Error: CANVAS_UI_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}
  },25000);
});





async function observeUpload(s:Session,run:()=>Promise<void>):Promise<number>{
 let count=0,expired=false,notify:()=>void=()=>{};const started=Date.now();const arrived=new Promise<void>(resolve=>{notify=resolve;});
 const listener=():void=>{count++;notify();};s.page.on('filechooser',listener);const timer=setTimeout(()=>{expired=true;notify();},1500);
 try{await run();await arrived;console.log('CANVAS_UI_UPLOAD_OBSERVATION',JSON.stringify({count,expired,elapsedMs:Date.now()-started}));return count;}
 finally{clearTimeout(timer);s.page.off('filechooser',listener);}
}

describe('canvas shell upload click',()=>{it.each(THEMES)('%s opens the existing upload chooser without sending a file',async theme=>{await withSession(theme,390,844,{},async s=>{const count=await observeUpload(s,()=>s.page.locator('[data-canvas-empty-state]').getByRole('button',{name:'上传图片',exact:true}).click());await trace(s);expect(count,'upload opens chooser with native click').toBe(1);expect(await view(s)).toEqual({offsetX:0,offsetY:0,zoom:1});expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images)).toEqual([]);});},25000);});


async function swipeUp(s:Session,scroll:Locator):Promise<void>{
 const r=await scroll.boundingBox();if(!r)throw Error('CANVAS_UI_FIXTURE_TOUCH_RECT');const x=r.x+r.width/2,start=Math.min(r.y+r.height-16,s.page.viewportSize()!.height-96),end=Math.max(r.y+24,start-115);if(start-end<40)throw Error('CANVAS_UI_FIXTURE_TOUCH_DISTANCE');
 const input=await s.context.newCDPSession(s.page);let primary:unknown,active=false;const cleanup:unknown[]=[];
 try{await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start,id:0,radiusX:5,radiusY:5,force:1}]});active=true;
 for(let step=1;step<=10;step++){await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start+(end-start)*step/10,id:0,radiusX:5,radiusY:5,force:1}]});await settle(s.page);}
 await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;
 }catch(error){primary=error;}
 if(active)try{await input.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch(error){cleanup.push(error);}
 try{await input.detach();}catch(error){cleanup.push(error);}
 if(primary&&cleanup.length)throw new AggregateError([primary,...cleanup],'CANVAS_UI_FIXTURE_TOUCH_COMMAND_AND_CLEANUP');if(primary)throw primary;if(cleanup.length)throw new AggregateError(cleanup,'CANVAS_UI_FIXTURE_TOUCH_CLEANUP');
}
describe('canvas shell synthetic touch',()=>{it.each(THEMES.flatMap(theme=>(['help','navigation'] as const).map(kind=>({theme,kind}))))('$theme $kind scrolls with an owned Chromium synthetic touch gesture',async({theme,kind})=>{await withSession(theme,kind==='help'?390:640,kind==='help'?844:320,{touch:true},async s=>{
 if(kind==='help')await keyboardHelp(s);else{const open=s.page.locator('[data-toolbar="left-toolbar"]').getByRole('button',{name:'展开工具栏',exact:true});await open.focus();await open.press('Enter');await settle(s.page);}
 const scroll=kind==='help'?helpPanel(s).locator(':scope > div').nth(1):s.page.locator('[data-toolbar="left-toolbar"] > div');if(kind==='navigation')expect(await scroll.evaluate(e=>e.scrollHeight),'navigation content needs viewport scrolling').toBeGreaterThan(232);
 const element=await scroll.elementHandle();if(!element)throw Error('CANVAS_UI_FIXTURE_TOUCH_ELEMENT');
 const before=await view(s);let reached=false,primary:unknown;const cleanup:unknown[]=[];const ready=s.page.waitForFunction(e=>e.scrollTop>0,element,{timeout:1500}).then(()=>{reached=true;},error=>{if(!(error instanceof playwrightErrors.TimeoutError))throw error;});
 try{await swipeUp(s,scroll);await ready;console.log('CANVAS_UI_SYNTHETIC_TOUCH',JSON.stringify({theme,kind,scrollTop:await scroll.evaluate(e=>e.scrollTop),reached,physicalAndroid:false}));expect(reached,'synthetic touch scrolls the intended UI').toBe(true);expect(await view(s),'synthetic UI touch preserves canvas view').toEqual(before);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.actions),'scroll gesture does not activate navigation').toEqual([]);}
 catch(error){primary=error;}
 try{await ready;}catch(error){cleanup.push(error);}try{await element.dispose();}catch(error){cleanup.push(error);}
 if(primary&&cleanup.length)throw new AggregateError([primary,...cleanup],'CANVAS_UI_FIXTURE_TOUCH_OBSERVER_AND_CLEANUP');if(primary)throw primary;if(cleanup.length)throw new AggregateError(cleanup,'CANVAS_UI_FIXTURE_TOUCH_OBSERVER_CLEANUP');
 });},25000);});

async function textContrast(control: Locator, placeholder = false): Promise<number> {
  return control.evaluate((element, isPlaceholder) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('CANVAS_UI_FIXTURE_CONTRAST_CANVAS');
    type Rgba = [number, number, number, number]; type Rgb = [number, number, number];
    const rgba = (value: string): Rgba => {
      if (!CSS.supports('color', value) || /^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value)) throw Error('CANVAS_UI_FIXTURE_CONTRAST_COLOR');
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const blend = (front: Rgba, back: Rgb): Rgb => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])) as Rgb;
    const luminance = (rgb: Rgb): number => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (ratio([255, 255, 255], [255, 255, 255]) !== 1 || Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) > 0.000001) throw Error('CANVAS_UI_FIXTURE_CONTRAST_CANARY');
    const layers: Rgba[] = []; let opaque = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backgroundImage !== 'none') throw Error('CANVAS_UI_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
      const color = rgba(style.backgroundColor); layers.push(color); if (color[3] === 1) { opaque = true; break; }
    }
    if (!opaque) throw Error('CANVAS_UI_FIXTURE_CONTRAST_BACKDROP_REQUIRED');
    let backdrop: Rgb = [255, 255, 255]; for (const layer of layers.reverse()) backdrop = blend(layer, backdrop);
    const own = getComputedStyle(element); if (own.filter !== 'none' || own.mixBlendMode !== 'normal' || own.backgroundImage !== 'none') throw Error('CANVAS_UI_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
    const background = blend(rgba(own.backgroundColor), backdrop), ownOpacity = Number(own.opacity);
    const text = isPlaceholder ? getComputedStyle(element, '::placeholder') : own;
    const paint = rgba(text.color); if (isPlaceholder) paint[3] *= Number(text.opacity);
    return ratio(blend([...blend(paint, background), ownOpacity], backdrop), blend([...background, ownOpacity], backdrop));
  }, placeholder);
}

describe('canvas shell help contrast',()=>{it.each(THEMES)('%s keeps actual help labels and close icon readable',async theme=>{await withSession(theme,390,844,{},async s=>{
 await keyboardHelp(s);const body=[] as Array<{label:string;ratio:number}>;for(const label of ['画布操作','选择图片','左键单击','图片编辑工具'])body.push({label,ratio:await textContrast(helpPanel(s).getByText(label,{exact:true}))});
 body.push({label:'首个工具说明',ratio:await textContrast(helpPanel(s).locator('p').first())});
 const close=helpClose(s),normal=await textContrast(close);await close.hover();await close.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)).then(()=>undefined));const hover=await textContrast(close);
 console.log('CANVAS_UI_HELP_CONTRAST',JSON.stringify({theme,body,icon:{normal,hover}}));expect(Math.min(...body.map(r=>r.ratio)),'help body text contrast').toBeGreaterThanOrEqual(4.5);expect(Math.min(normal,hover),'help close icon contrast').toBeGreaterThanOrEqual(3);
 expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images)).toEqual([]);
 });},25000);});
