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
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;elementState?:'idle'|'partial'|'cancelled'|'local-fallback'|'busy'|'recovery-error'}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number;cwReleasePoll:()=>void}
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
const bxDescriptor={providerId:'bx-provider',modelId:'bx-image',kind:'image' as const,sourceType:'image' as const,protocol:'openai',executionMode:'sync' as const,allowedRatios:['1:1','3:2'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:2,supportsVision:false,supportsReferenceImages:true,maxReferenceImages:14,supportsMask:false,allowedDurationsSeconds:[],maxDurationSeconds:0,supportedOperations:['image-to-image','multi-reference'] as Array<'image-to-image'|'multi-reference'>,outputKinds:['image'],capabilitySources:{allowedRatios:'admin' as const,allowedSizes:'admin' as const,qualityOptions:'admin' as const,supportsReferenceImages:'admin' as const,maxReferenceImages:'admin' as const}};
const bxUnsupported={...bxDescriptor,modelId:'bx-no-reference',supportsReferenceImages:false,maxReferenceImages:0};
const bySecond={...bxDescriptor,providerId:'by-provider-b',maxReferenceImages:2,allowedRatios:['1:1','16:9'],allowedSizes:['1536x1024'],qualityOptions:['hd'],maxOutputs:1};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,x:100,y:160,width:56,height:56,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:270,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
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
    let cwReleasePoll:()=>void=()=>{};const cwGate=options.elementState==='busy'?new Promise<void>(resolve=>{cwReleasePoll=resolve;}):Promise.resolve();
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),releaseRecovery,recoveryCalls:0,cwReleasePoll }; value = s; live.add(s);
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
        if (count > (key==='/api/element-decompose?projectId=canvas-ui-project'&&options.elementState==='recovery-error'?2:['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:503,json:{success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE'} });return; }
        if(key==='/api/element-decompose?projectId=canvas-ui-project'){
          if(options.elementState==='idle'||options.elementState==='recovery-error'&&count===2){await route.fulfill({status:404,json:{success:false,code:'CW_NO_TASK'}});return;}
          if(options.elementState==='recovery-error'){await route.fulfill({status:500,json:{success:false,code:'CW_SYNTHETIC_READ_FAILURE',message:'CW_UI_ONLY_READ_FAILURE'}});return;}
          await route.fulfill({json:cwTask(s,options.elementState||'idle')});return;
        }
        if(key==='/api/element-decompose?taskId=cw-owned-active'){
          if(options.elementState!=='busy')throw Error('CW_POLL_ONLY_OWN_BUSY_FIXTURE');
          await cwGate;await route.fulfill({json:cwTask(s,'cancelled')});return;
        }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('wujie_selected_model',JSON.stringify({model:'bx-provider::bx-image',providerId:'bx-provider'}));localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
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
  const allowed=['/','/api/element-decompose?projectId=canvas-ui-project','/api/element-decompose?taskId=cw-owned-active','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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









async function cwReveal(s:Session,control:Locator):Promise<void>{for(let i=0;i<12;i++){const state=await control.evaluate(el=>{const r=el.getBoundingClientRect();for(let p=el.parentElement;p;p=p.parentElement){const style=getComputedStyle(p);if(['auto','scroll'].includes(style.overflowY)&&p.scrollHeight>p.clientHeight){const b=p.getBoundingClientRect();return {rect:{top:r.top,bottom:r.bottom},scroll:{x:b.right-8,top:Math.max(4,b.top+4),bottom:Math.min(innerHeight-4,b.bottom-4)}};}}return {rect:{top:r.top,bottom:r.bottom},scroll:null};});if(!state.scroll||state.rect.top>=state.scroll.top&&state.rect.bottom<=state.scroll.bottom)return;const b=state.scroll,dy=state.rect.top<b.top?Math.min(110,b.bottom-b.top-24):-Math.min(110,b.bottom-b.top-24),y=dy<0?b.bottom-16:b.top+16,c=await s.context.newCDPSession(s.page);try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x,y,id:1}]});try{for(const t of [.25,.5,.75,1]){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x,y:y+dy*t,id:1}]});await settle(s.page);}}finally{await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}}finally{await c.detach();}}throw Error('CL_NATIVE_SCROLL_BOUND');}



type CWState='idle'|'partial'|'cancelled'|'local-fallback'|'busy'|'recovery-error';
interface CWEntry {theme:Theme;width:number;height:number;state:CWState}
const cwMatrix:CWEntry[]=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].flatMap(([width,height])=>(['idle','partial','cancelled','local-fallback','busy','recovery-error']as const).map(state=>({theme,width,height,state}))));
function cwTask(s:Session,state:CWState):Record<string,unknown>{const url='data:image/png;base64,'+s.png.toString('base64'),busy=state==='busy',cancelled=state==='cancelled',fallback=state==='local-fallback';return {success:true,taskId:s.options.elementState==='busy'?'cw-owned-active':'cw-owned-terminal',status:busy?'processing':cancelled?'cancelled':'completed',overallStatus:busy?'processing':cancelled?'cancelled':fallback?'completed':'partial',progress:busy?25:cancelled?40:100,source:{sourceImageId:'br-A',sourceVersionId:'cw-ui-v1',canonicalUrl:url,managedUrl:url,sha256:'0'.repeat(64),width:64,height:64,mimeType:'image/png'},branches:{board:{branch:'board',taskId:'cw-board',status:busy?'processing':cancelled?'cancelled':'completed',progress:busy?25:cancelled?40:100,result:busy||cancelled?undefined:{imageUrl:url}},layers:{branch:'layers',taskId:'cw-layers',status:busy?'queued':cancelled?'cancelled':fallback?'completed':'failed',progress:busy?0:cancelled?40:fallback?100:45,error:!fallback&&!busy&&!cancelled?'CW_SYNTHETIC_BRANCH_FAILURE':undefined,creditStatus:fallback?'refunded':undefined,fallbackReason:fallback?'CW_UI_ONLY_LOCAL_FALLBACK':undefined,providerError:fallback?{message:'CW_SYNTHETIC_UPSTREAM_FAILURE'}:undefined,result:fallback?{engine:'local',width:64,height:64,quality:{status:'warning',score:0,warnings:['CW_UI_ONLY_NOT_QUALITY_PROOF']},layers:[{id:'cw-layer',name:'CW 局部示例',role:'subject',imageUrl:url,width:64,height:64,offsetX:0,offsetY:0,opacity:1,blendMode:'normal',visible:true,source:'local-enhanced'}]}:undefined}}};}
async function cwWithSession(e:CWEntry,run:(s:Session)=>Promise<void>):Promise<void>{await withSession(e.theme,e.width,e.height,{touch:true,elementState:e.state},async s=>{let primary:unknown;try{await run(s);}catch(error){primary=error;}s.cwReleasePoll();try{await nativeRequestsFinished(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CW_PRIMARY_AND_OWN_POLL_CLEANUP');throw cleanup;}if(primary)throw primary;});}
async function cwCapture(s:Session,e:CWEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-element-cw-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+e.state+'-'+label+'.png');await s.page.screenshot({path:file});console.log('CW_CAPTURE',JSON.stringify({path:file,label,syntheticReadOnlyStateNotPaidOrBusinessProof:true}));}
async function cwAuditAll(s:Session,panel:Locator):Promise<void>{const controls=panel.locator('button,input,select,textarea');for(let i=0;i<await controls.count();i++){const control=controls.nth(i);await cwReveal(s,control);const v=await control.evaluate(el=>{const r=el.getBoundingClientRect(),faults:string[]=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.left<r.left-.5||b.right>r.right+.5||b.top<r.top-.5||b.bottom>r.bottom+.5)faults.push('text-clipped');}return {name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),faults};});console.log('CW_CONTROL',JSON.stringify(v));expect.soft(v.width,v.name+' touch width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' touch height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' native visible hit').toBe(true);expect.soft(v.faults,v.name+' readable').toEqual([]);expect.soft(v.name,'accessible control purpose').not.toBe('');}}
async function cwTap(s:Session,control:Locator):Promise<void>{await cwReveal(s,control);await control.tap();await settle(s.page);}
async function cwOpen(s:Session):Promise<Locator>{await s.page.locator('[data-mobile-image-actions]').getByRole('button',{name:'更多',exact:true}).tap();const item=s.page.getByRole('dialog',{name:'图片工具',exact:true}).getByRole('button',{name:'元素拆解',exact:true});await Promise.all([s.page.waitForResponse(r=>r.url()===ORIGIN+'/api/element-decompose?projectId=canvas-ui-project'),item.tap()]);const panel=s.page.locator('[data-popup="display-decompose"]');await panel.waitFor({state:'visible'});await settle(s.page);return panel;}
async function cwClose(s:Session,panel:Locator):Promise<void>{await cwTap(s,panel.locator('button').first());await panel.waitFor({state:'detached'});await s.page.waitForTimeout(600);}
for(const e of cwMatrix)it('CW '+e.theme+' '+e.width+'x'+e.height+' '+e.state+' element panel native read-only status parameters and close stay mobile usable',async()=>{
 await cwWithSession(e,async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);try{await s.page.locator('[data-canvas-image-id="br-A"]').tap({position:{x:28,y:38}});let panel=await cwOpen(s);const submit=()=>panel.locator('[data-action="submit-element-decompose"]');
 if(e.state==='busy'){await s.page.waitForFunction(()=>Boolean((document.querySelector('[data-action="submit-element-decompose"]')as HTMLButtonElement|null)?.disabled),undefined,{timeout:1500});await cwAuditAll(s,panel);await cwCapture(s,e,'busy');console.log('CW_BUSY_OBSERVED',JSON.stringify({...e,disabledWhileOriginalPollPending:true,noCancelOrSubmit:true}));s.cwReleasePoll();await nativeRequestsFinished(s);await panel.locator('[data-element-status="cancelled"]').waitFor({state:'visible'});expect(await submit().isDisabled()).toBe(false);}
 else if(e.state==='recovery-error'){const alert=panel.getByRole('alert');await alert.waitFor({state:'visible'});expect(await alert.textContent()).toContain('读取历史任务失败');await cwAuditAll(s,panel);await cwCapture(s,e,'recover-error');await cwClose(s,panel);panel=await cwOpen(s);await nativeRequestsFinished(s);expect(await panel.getByRole('alert').count(),'reopened no-task result clears prior read error').toBe(0);console.log('CW_READ_ERROR_RECOVERED',JSON.stringify({...e,originalReadOnlyReopen:true,noSubmit:true}));}
 else{await nativeRequestsFinished(s);if(e.state==='idle')expect(await panel.locator('[data-element-status]').count()).toBe(0);else{const expected=e.state==='local-fallback'?'completed':e.state;await panel.locator('[data-element-status="'+expected+'"]').waitFor({state:'visible'});if(e.state==='partial'){expect(await panel.getByRole('button',{name:'仅重试此分支',exact:true}).count()).toBe(1);expect(await panel.getByText('部分完成：已保留成功结果，可单独重试失败分支。',{exact:true}).count()).toBe(1);}if(e.state==='cancelled')expect(await panel.getByRole('button',{name:'仅重试此分支',exact:true}).count()).toBe(2);if(e.state==='local-fallback'){expect(await panel.getByRole('button',{name:'打开编辑器',exact:true}).count()).toBe(1);expect(await panel.locator('[data-layer-fallback="refunded-local"]').textContent()).toBe('Pear 云端分层未完成，已退款并使用本地分层');}}}
 await cwCapture(s,e,'opened-or-restored');await cwAuditAll(s,panel);const outputs=panel.locator('[aria-label="元素拆解输出方式"]');for(const [label,action]of [['拆解板','生成拆解板'],['可编辑图层','生成可编辑图层'],['双输出','生成拆解板与图层']]){const choice=outputs.getByRole('button',{name:label,exact:true});await cwTap(s,choice);expect(await submit().textContent()).toContain(action);expect.soft(await choice.getAttribute('aria-pressed'),label+' selected state exposed').toBe('true');}for(const ratio of ['1:1','3:2','2:3','4:3','3:4','4:5','5:4','16:9','9:16']){const choice=panel.getByRole('button',{name:ratio,exact:true});await cwTap(s,choice);expect.soft(await choice.getAttribute('aria-pressed'),ratio+' selected state exposed').toBe('true');}const auto=panel.getByRole('button',{name:'自动去背景（透明 PNG）',exact:true});await cwTap(s,auto);expect.soft(await auto.getAttribute('aria-pressed')).toBe('false');await cwTap(s,auto);expect.soft(await auto.getAttribute('aria-pressed')).toBe('true');console.log('CW_PARAMETERS_COMPLETE',JSON.stringify({...e,threeOutputLabels:true,nineRatiosAndToggleExposed:true,noGenerateRetryEditorOrTaskCancel:true}));await cwCapture(s,e,'parameters');await cwClose(s,panel);const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);expect(s.counts.get('/api/element-decompose?projectId=canvas-ui-project')).toBe(e.state==='recovery-error'?2:1);expect(s.counts.get('/api/element-decompose?taskId=cw-owned-active')||0).toBe(e.state==='busy'?1:0);console.log('CW_COMPLETE',JSON.stringify({...e,assetsAndViewUnchanged:true,closed:true,exactReadOnlyRecoveryCounts:true,noBusinessMutation:true}));}finally{await cwCapture(s,e,'end-or-failure');}});
},25000);
