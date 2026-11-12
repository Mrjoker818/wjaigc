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
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
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
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],groups:[] as Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>,actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,x:112,y:116,width:80,height:80,groupId:'br-G',prompt:'BR成员A'},{id:'br-B',url:png,x:224,y:136,width:64,height:64,groupId:'br-G',prompt:'BR成员B'},{id:'br-keep',url:png,x:400,y:120,width:64,height:64,prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState([{id:'br-G',name:'BR 原组名',note:'',imageIds:['br-A','br-B'],x:100,y:68,collapsed:false}]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed isAdmin={admin}
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
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




interface BREntry {theme:Theme;width:number;height:number}
interface BRGroup {id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}
interface BRImage {id:string;x:number;y:number;groupId?:string}
const MATRIX=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
const group=(s:Session):Locator=>s.page.locator('[data-toolbar="image-group"]');
async function snapshot(s:Session):Promise<FixtureWindow['canvasUi']['state']>{return s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);}
async function audit(b:Locator,label:string,input=false):Promise<void>{await b.scrollIntoViewIfNeeded();const v=await b.evaluate(e=>{const r=e.getBoundingClientRect(),faults:string[]=[];for(let p=e.parentElement;p;p=p.parentElement){const css=getComputedStyle(p),a=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(css.overflowX)&&((r.left<a.left-.5)||(r.right>a.right+.5)))faults.push('ancestor-x-clipped');if(/hidden|clip|auto|scroll/.test(css.overflowY)&&((r.top<a.top-.5)||(r.bottom>a.bottom+.5)))faults.push('ancestor-y-clipped');}const range=document.createRange();if(!(e instanceof HTMLInputElement)){range.selectNodeContents(e);for(const g of range.getClientRects())if(g.left<r.left-.5||g.right>r.right+.5||g.top<r.top-.5||g.bottom>r.bottom+.5)faults.push('glyph-clipped');}return {width:r.width,height:r.height,font:parseFloat(getComputedStyle(e).fontSize),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:[[r.x+r.width/2,r.y+r.height/2],[r.left+1,r.y+r.height/2],[r.right-1,r.y+r.height/2],[r.x+r.width/2,r.top+1],[r.x+r.width/2,r.bottom-1]].every(([x,y])=>e.contains(document.elementFromPoint(x,y))),faults};});console.log('BR_CONTROL',JSON.stringify({label,input,...v}));expect.soft(v.width,label+' width').toBeGreaterThanOrEqual(44);expect.soft(v.height,label+' height').toBeGreaterThanOrEqual(44);if(input)expect.soft(v.font,label+' font').toBeGreaterThanOrEqual(16);expect.soft(v.inside&&v.hit,label+' native hit').toBe(true);expect.soft(v.faults,label+' clipped').toEqual([]);}
async function tap(s:Session,b:Locator):Promise<void>{const r=await b.boundingBox();if(!r)throw Error('BR_TAP_RECT');await s.page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await settle(s.page);}
async function openEditor(s:Session,name:string):Promise<void>{const explicit=group(s).getByRole('button',{name:'编辑图片组',exact:true});let desktopFallback=false;if(await explicit.count())await tap(s,explicit);else{const label=group(s).getByText(name,{exact:true});await tap(s,label);await tap(s,label);}let count=await s.page.getByRole('textbox').count();expect.soft(count,'native group editor opens').toBe(2);if(count!==2){desktopFallback=true;await group(s).getByText(name,{exact:true}).dblclick();count=await s.page.getByRole('textbox').count();}console.log('BR_EDITOR_ENTRY',JSON.stringify({name,nativeExplicit:await explicit.count()>0,desktopFallback,count}));expect(count,'editor diagnostic availability').toBe(2);}
let captureIndex=0;
async function capture(s:Session,e:BREntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-group-br-native-20261019',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+(++captureIndex)+'-'+label+'.png');await s.page.screenshot({path:file});console.log('BR_CAPTURE',JSON.stringify({path:file,label,coze:false,physicalAndroid:false,serverPersistence:false}));}
async function check(e:BREntry,run:(s:Session)=>Promise<void>):Promise<void>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{try{await group(s).waitFor();for(const name of ['折叠','取消分组'])await audit(group(s).getByRole('button',{name,exact:true}),name);await capture(s,e,'before-action');await run(s);await capture(s,e,'end');}catch(error){await capture(s,e,'failure');throw error;}});}
it('BR mobile ungroup ignores a cancelled touch and accepts keyboard activation', async () => {
  await withSession('mono', 390, 844, { touch: true }, async s => {
    const before = await snapshot(s);
    const ungroup = group(s).getByRole('button', { name: '取消分组', exact: true });
    const bounds = await ungroup.boundingBox();
    if (!bounds) throw Error('BR_UNGROUP_RECT');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const cdp = await s.context.newCDPSession(s.page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    await settle(s.page);
    expect((await snapshot(s)).groups).toEqual(before.groups);
    expect((await snapshot(s)).images).toEqual(before.images);

    await ungroup.focus();
    await s.page.keyboard.press('Enter');
    await group(s).waitFor({ state: 'detached' });
    const after = await snapshot(s);
    expect(after.groups).toEqual([]);
    expect(after.images).toEqual((before.images as BRImage[]).map(image =>
      image.id === 'br-keep' ? image : { ...image, groupId: undefined },
    ));
  });
}, 25000);
for(const e of MATRIX){
 it('BR '+e.theme+' '+e.width+'x'+e.height+' group fold and expand preserves every image and metadata',async()=>{await check(e,async s=>{const before=await snapshot(s);await tap(s,group(s).getByRole('button',{name:'折叠',exact:true}));expect(await s.page.locator('[data-canvas-image-id="br-A"]').isVisible()).toBe(false);expect(await s.page.locator('[data-canvas-image-id="br-B"]').isVisible()).toBe(false);const folded=await snapshot(s);expect((folded.groups as BRGroup[])[0].collapsed).toBe(true);expect(folded.images).toEqual(before.images);await tap(s,group(s).getByRole('button',{name:'展开',exact:true}));expect(await s.page.locator('[data-canvas-image-id="br-A"]').isVisible()).toBe(true);expect(await s.page.locator('[data-canvas-image-id="br-B"]').isVisible()).toBe(true);const after=await snapshot(s);expect(after.groups).toEqual(before.groups);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('BR_FOLD',JSON.stringify({folded:(folded.groups as BRGroup[])[0].collapsed,restored:after.groups,view:after.view}));});},25000);
 it('BR '+e.theme+' '+e.width+'x'+e.height+' group edits name and note then cancels a later edit',async()=>{await check(e,async s=>{const before=await snapshot(s);await openEditor(s,'BR 原组名');const fields=s.page.getByRole('textbox');await audit(fields.nth(0),'组名',true);await audit(fields.nth(1),'备注',true);await capture(s,e,'editor-open');await fields.nth(0).fill('BR 新组名');await tap(s,fields.nth(1));const survived=await fields.count();expect.soft(survived,'switching to note retains editor').toBe(2);if(survived===2)await fields.nth(1).fill('BR 新备注');const save=s.page.getByRole('button',{name:'保存',exact:true});if(await save.count()){await audit(save,'保存');await tap(s,save);}else{await s.page.touchscreen.tap(e.width-12,e.height-104);await settle(s.page);}const saved=await snapshot(s);expect.soft(saved.groups).toEqual((before.groups as BRGroup[]).map(v=>({...v,name:'BR 新组名',note:'BR 新备注'})));expect(saved.images).toEqual(before.images);expect(saved.view).toEqual(before.view);await openEditor(s,'BR 新组名');await s.page.getByRole('textbox').nth(0).fill('BR 不保存');const cancel=s.page.getByRole('button',{name:'取消',exact:true});if(await cancel.count()){await audit(cancel,'取消编辑');await tap(s,cancel);}else await s.page.keyboard.press('Escape');const after=await snapshot(s);expect(after.groups).toEqual(saved.groups);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('BR_EDIT',JSON.stringify({noteEditorSurvived:survived===2,saved:saved.groups,afterCancel:after.groups,view:after.view}));});},25000);
 it('BR '+e.theme+' '+e.width+'x'+e.height+' group native drag moves only members and ungroup keeps assets',async()=>{await check(e,async s=>{const before=await snapshot(s),label=group(s).getByText('BR 原组名',{exact:true}),r=await label.boundingBox();if(!r)throw Error('BR_DRAG_RECT');const x=r.x+r.width/2,y=r.y+r.height/2,cdp=await s.context.newCDPSession(s.page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await s.page.waitForTimeout(240);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+6,y:y+10,id:1}]});await settle(s.page);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+12,y:y+20,id:1}]});await settle(s.page);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(s.page);await cdp.detach();const moved=await snapshot(s);expect.soft(moved.images).toEqual((before.images as BRImage[]).map(v=>v.id==='br-keep'?v:{...v,x:v.x+12,y:v.y+20}));expect(moved.groups).toEqual(before.groups);expect(moved.view).toEqual(before.view);await audit(group(s).getByRole('button',{name:'取消分组',exact:true}),'移动后解组');await tap(s,group(s).getByRole('button',{name:'取消分组',exact:true}));const after=await snapshot(s);expect(await group(s).count()).toBe(0);expect(after.groups).toEqual([]);expect(after.images).toEqual((moved.images as BRImage[]).map(v=>v.id==='br-keep'?v:{...v,groupId:undefined}));expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('BR_DRAG_UNGROUP',JSON.stringify({before:(before.images as BRImage[]).map(v=>({id:v.id,x:v.x,y:v.y})),moved:(moved.images as BRImage[]).map(v=>({id:v.id,x:v.x,y:v.y})),after:(after.images as BRImage[]).map(v=>({id:v.id,x:v.x,y:v.y,groupId:v.groupId})),groups:after.groups,view:after.view}));});},25000);
}
