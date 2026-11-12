// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
import { isCompletedCanvasFixtureEventStream } from '../helpers/canvas-fixture-event-stream';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number}
const ORIGIN='https://canvas-shell-mobile.invalid';
const THEMES:readonly Theme[]=['gold','mono'];
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InfiniteCanvas,type CanvasImage} from '@/components/infinite-canvas';
import {TreeHistoryManager} from '@/lib/canvas-tree-history';
import {taskEventsClient} from '@/lib/task-events-client';
import {OperationAuditClient} from '@/components/operation-audit-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('CANVAS_UI_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const manager=new TreeHistoryManager();
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed isAdmin={admin}
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/></>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
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
    let releaseRecovery:()=>void=()=>{};const recoveryGate=options.holdRecovery?new Promise<void>(resolve=>{releaseRecovery=resolve;}):Promise.resolve();
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),releaseRecovery,recoveryCalls:0 }; value = s; live.add(s);
    context.on('request', request => s.pending.add(request));
    context.on('response', response => s.responseStatus.set(response.request(),response.status()));
    context.on('requestfinished', request => { s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => {
      s.pending.delete(request);
      const completed = isCompletedCanvasFixtureEventStream(request, s.responseStatus.get(request), ORIGIN);
      (completed ? s.completed : s.failed).add(request);
      for (const notify of s.nativeWaiters) notify();
    });
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
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
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
    console.log('BB_FETCH_RECEIVER_DIAG',JSON.stringify(await page.evaluate(async()=>{const errors:string[]=[];const holder={fetcher:window.fetch};try{await holder.fetcher('http://[');}catch(error){errors.push(String(error));}try{await window.fetch('http://[');}catch(error){errors.push(String(error));}return errors;})));
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
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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

interface BBEntry {theme:Theme;width:number;height:number;mode?:'image'|'code';holdRecovery?:boolean;catalogLoading?:boolean}
let captureIndex=0;
function panel(s:Session):Locator{return s.page.getByRole('region',{name:'草图创作',exact:true});}
async function capture(s:Session,entry:BBEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-first-stroke-bb-native-20261019',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,`${entry.theme}-${entry.width}x${entry.height}-${++captureIndex}-${label}.png`);await s.page.screenshot({path:file});console.log('BB_CAPTURE',JSON.stringify({path:file,label,physicalAndroid:false,coze:false}));}
async function check(entry:BBEntry,run:(s:Session)=>Promise<void>):Promise<void>{await withSession(entry.theme,entry.width,entry.height,entry,async s=>{let primary:unknown;try{await run(s);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images)).toEqual([]);await capture(s,entry,'end');}catch(error){primary=error;try{await capture(s,entry,'failure');}catch(other){primary=new AggregateError([error,other],'BB_CAPTURE_AND_SCENARIO');}}try{s.releaseRecovery();await nativeRequestsFinished(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'BB_SCENARIO_AND_RELEASE');throw cleanup;}if(primary)throw primary;});}
async function click(s:Session,control:Locator):Promise<void>{const b=await control.boundingBox();if(!b)throw Error('BB_NATIVE_RECT');expect(await control.evaluate(e=>{const b=e.getBoundingClientRect();return e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),'native center hit').toBe(true);await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await settle(s.page);}
async function target(control:Locator):Promise<void>{const d=await control.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:[[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b])=>e.contains(document.elementFromPoint(a,b)))};});expect(d.width).toBeGreaterThanOrEqual(44);expect(d.height).toBeGreaterThanOrEqual(44);expect(d.inside&&d.hit).toBe(true);}
async function reveal(s:Session,control:Locator):Promise<void>{const scroll=panel(s).locator(':scope > div').nth(1);for(let i=0;i<8;i++){const b=await scroll.boundingBox(),r=await control.boundingBox();if(!b||!r)throw Error('BB_SCROLL_RECT');if(r.y>=b.y+1&&r.y+r.height<=b.y+b.height-1)return;const delta=r.y<b.y+1?r.y-b.y-3:r.y+r.height-b.y-b.height+3;await s.page.mouse.move(b.x+b.width-5,b.y+b.height/2);await s.page.mouse.wheel(0,delta);await settle(s.page);}throw Error('BB_BOUNDED_SCROLL');}
async function pixels(canvas:Locator):Promise<number>{return canvas.evaluate(e=>{const c=e as HTMLCanvasElement,ctx=c.getContext('2d');if(!ctx)throw Error('BB_REAL_CANVAS2D');const data=ctx.getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i]<230&&data[i+1]<230&&data[i+2]<230&&data[i+3]>128)dark++;return dark;});}
async function firstStroke(s:Session,entry:BBEntry):Promise<void>{
 const started=Date.now(),bar=s.page.locator('[data-mobile-canvas-toolbar]');await click(s,bar.getByRole('button',{name:'全部工具',exact:true}));const drawer=s.page.getByRole('dialog',{name:'全部工具',exact:true}),sketch=drawer.getByRole('button',{name:'草图创作',exact:true});
 for(let i=0;i<8;i++){const b=await drawer.boundingBox(),r=await sketch.boundingBox();if(!b||!r)throw Error('BB_OPEN_RECT');if(r.y>=b.y+1&&r.y+r.height<=b.y+b.height-1)break;await s.page.mouse.move(b.x+b.width-5,b.y+b.height/2);await s.page.mouse.wheel(0,r.y+r.height-b.y-b.height+3);await settle(s.page);}
 await click(s,sketch);await panel(s).waitFor();if(entry.mode==='code')await click(s,panel(s).getByRole('button',{name:'草图转代码',exact:true}));const canvas=panel(s).getByLabel('绘图区',{exact:true});await canvas.waitFor();const ready=Date.now(),before=await pixels(canvas);expect(before).toBe(0);
 const b=await canvas.boundingBox(),scroll=panel(s).locator(':scope > div').nth(1),v=await scroll.boundingBox();if(!b||!v)throw Error('BB_DRAW_RECT');const top=Math.max(b.y,v.y),bottom=Math.min(b.y+b.height,v.y+v.height,entry.height-8);expect(bottom-top,'first paint has a visible drawing strip').toBeGreaterThan(20);const y=top+(bottom-top)*.4,x1=b.x+b.width*.25,x2=b.x+b.width*.7;
 expect(await canvas.evaluate((e,p)=>e===document.elementFromPoint(p.x,p.y),{x:x1,y}),'first stroke is on the real canvas').toBe(true);const attempt=Date.now();await s.page.mouse.move(x1,y);await s.page.mouse.down();await s.page.mouse.move(x2,y,{steps:8});await s.page.mouse.up();await settle(s.page);const after=await pixels(canvas);expect(after,'first immediate native stroke paints real pixels').toBeGreaterThan(10);
 expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.scopeChecks)).toBeGreaterThan(0);try{await expect.poll(()=>s.recoveryCalls,{timeout:1500}).toBe(1);}catch(error){console.log('BB_RECOVERY_DIAG',JSON.stringify({calls:s.recoveryCalls,counts:[...s.counts],errors:s.errors,scopeChecks:await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.scopeChecks),text:await panel(s).innerText()}));throw error;}if(entry.holdRecovery)expect([...s.pending].some(r=>r.url().endsWith('/api/tasks/recover?projectId=canvas-ui-project')),'recovery is genuinely pending while painting').toBe(true);
 console.log('BB_FIRST_STROKE',JSON.stringify({theme:entry.theme,mode:entry.mode,width:entry.width,height:entry.height,holdRecovery:!!entry.holdRecovery,catalogLoading:!!entry.catalogLoading,openToCanvasMs:ready-started,firstAttemptAfterReadyMs:attempt-ready,pixelsBefore:before,pixelsAfter:after,physicalAndroid:false,coze:false}));
 const undo=panel(s).getByRole('button',{name:'撤销',exact:true}),redo=panel(s).getByRole('button',{name:'重做',exact:true});await reveal(s,undo);await click(s,undo);expect(await pixels(canvas),'undo removes actual pixels').toBe(0);await reveal(s,redo);await click(s,redo);expect(await pixels(canvas),'redo restores the same actual pixels').toBe(after);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual({offsetX:0,offsetY:0,zoom:1});
 const r=await scroll.boundingBox(),offset=await scroll.evaluate(e=>e.scrollTop);if(r&&offset){await s.page.mouse.move(r.x+r.width-5,r.y+r.height/2);await s.page.mouse.wheel(0,-offset);await settle(s.page);}
}
const FRESH=THEMES.flatMap(theme=>(['image','code'] as const).flatMap(mode=>[[320,640],[390,844]].map(([width,height])=>({theme,mode,width,height}))));
for(const entry of FRESH)it(`BB fresh ${entry.theme} ${entry.mode} ${entry.width} first native stroke`,async()=>{await check(entry,s=>firstStroke(s,entry));},25000);
for(const kind of ['holdRecovery','catalogLoading'] as const)for(const theme of THEMES)for(const mode of ['image','code'] as const){const entry={theme,mode,width:390,height:844,[kind]:true};it(`BB ${kind} ${theme} ${mode} first native stroke without waiting`,async()=>{await check(entry,s=>firstStroke(s,entry));},25000);}
for(const mode of ['image','code'] as const)it(`BB touch ${mode} first stroke while recovery is pending and model catalog is loading`,async()=>{
 const entry={theme:'gold' as const,mode,width:390,height:844,holdRecovery:true,catalogLoading:true};
 await check(entry,async s=>{
  const bar=s.page.locator('[data-mobile-canvas-toolbar]');await click(s,bar.getByRole('button',{name:'全部工具',exact:true}));
  const drawer=s.page.getByRole('dialog',{name:'全部工具',exact:true}),sketch=drawer.getByRole('button',{name:'草图创作',exact:true});
  for(let i=0;i<8;i++){const b=await drawer.boundingBox(),r=await sketch.boundingBox();if(!b||!r)throw Error('BB_TOUCH_OPEN_RECT');if(r.y>=b.y+1&&r.y+r.height<=b.y+b.height-1)break;await s.page.mouse.move(b.x+b.width-5,b.y+b.height/2);await s.page.mouse.wheel(0,r.y+r.height-b.y-b.height+3);await settle(s.page);}
  await click(s,sketch);await panel(s).waitFor();if(mode==='code')await click(s,panel(s).getByRole('button',{name:'草图转代码',exact:true}));
  const canvas=panel(s).getByLabel('绘图区',{exact:true});await canvas.waitFor();
  await expect.poll(()=>s.recoveryCalls,{timeout:1500}).toBe(1);
  expect([...s.pending].some(r=>r.url().endsWith('/api/tasks/recover?projectId=canvas-ui-project'))).toBe(true);
  expect(await panel(s).getByLabel(mode==='image'?'视觉分析模型':'视觉模型',{exact:true}).isDisabled()).toBe(true);
  if(mode==='image')expect(await panel(s).getByLabel('图像生成模型',{exact:true}).isDisabled()).toBe(true);
  expect(await pixels(canvas)).toBe(0);
  const b=await canvas.boundingBox(),v=await panel(s).locator(':scope > div').nth(1).boundingBox();if(!b||!v)throw Error('BB_TOUCH_DRAW_RECT');
  const top=Math.max(b.y,v.y),bottom=Math.min(b.y+b.height,v.y+v.height);expect(bottom-top).toBeGreaterThan(48);
  const x1=b.x+b.width*0.3,x2=b.x+b.width*0.7,y=top+(bottom-top)*0.5;
  expect(await canvas.evaluate((el,p)=>el===document.elementFromPoint(p.x,p.y),{x:x1,y})).toBe(true);
  const client=await s.context.newCDPSession(s.page);
  try{await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y,id:1}]});
   for(let i=1;i<=8;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/8,y,id:1}]});
   await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await client.detach();}
  await expect.poll(()=>pixels(canvas),{timeout:1500}).toBeGreaterThan(10);
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual({offsetX:0,offsetY:0,zoom:1});
 });
},25000);
const EMPTY=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
for(const entry of EMPTY)it(`BB empty ${entry.theme} ${entry.width}x${entry.height} literal text avoids the actual rail and bottom toolbar`,async()=>{await check(entry,async s=>{
 const empty=s.page.locator('[data-canvas-empty-state]'),bad=await empty.evaluate(e=>{const rail=document.querySelector('[data-toolbar="left-toolbar"] > div')?.getBoundingClientRect(),bar=document.querySelector('[data-mobile-canvas-toolbar]')?.getBoundingClientRect();if(!rail||!bar)throw Error('BB_REAL_RAIL_AND_BAR_REQUIRED');const bad:string[]=[];for(const item of e.querySelectorAll('h2,p,button'))for(const n of item.childNodes){if(n.nodeType!==Node.TEXT_NODE||!n.textContent?.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const g of r.getClientRects()){if(g.left<8||g.right>innerWidth-8||g.top<8||g.bottom>innerHeight-8)bad.push('outside');if(g.left<rail.right&&g.right>rail.left&&g.top<rail.bottom&&g.bottom>rail.top)bad.push('rail-overlap');if(g.left<bar.right&&g.right>bar.left&&g.top<bar.bottom&&g.bottom>bar.top)bad.push('bar-overlap');}}return bad;});expect(bad,'all empty-state literal glyphs clear visible controls').toEqual([]);
 const upload=empty.getByRole('button',{name:'上传图片',exact:true}),help=empty.getByRole('button',{name:'使用说明',exact:true});await target(upload);await target(help);const chooser=s.page.waitForEvent('filechooser',{timeout:1500});const [selected]=await Promise.all([chooser,click(s,upload)]);expect(selected.isMultiple()).toBe(true);await click(s,help);const close=s.page.getByRole('button',{name:'关闭画布帮助',exact:true});await close.waitFor();await click(s,close);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual({offsetX:0,offsetY:0,zoom:1});
});},25000);


