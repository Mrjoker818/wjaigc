// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
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
const panoramaPicture=document.createElement('canvas');panoramaPicture.width=256;panoramaPicture.height=128;const panoramaContext=panoramaPicture.getContext('2d');if(!panoramaContext)throw Error('DP_OWNED_PANORAMA_CANVAS');for(const [i,color]of ['#bc3d3d','#d68130','#c5ad38','#409b55','#32a6a3','#387ac1','#7454bc','#b4479e'].entries()){panoramaContext.fillStyle=color;panoramaContext.fillRect(i*32,0,32,128);}const panoramaPng=panoramaPicture.toDataURL();
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
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:panoramaPng,mediaType:'image' as const,x:40,y:60,width:240,height:120,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:190,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
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
    const s: Session = { context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),releaseRecovery,recoveryCalls:0 }; value = s; live.add(s);
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
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:200,contentType:'text/event-stream',headers:{'cache-control':'no-cache'},body:'data: '+JSON.stringify({type:'connected',transport:'offline',timestamp:0})+'\n\n:heartbeat\n\n' });return; }
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
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
  const keys=[...s.counts.keys()];
  if(s.options.requireMissing || s.counts.get('/')!==1 || keys.some(k=>!allowed.includes(k)&&!(expectedRefusal==='http'&&k==='/unexpected'))){
    console.log('CANVAS_UI_FIXTURE_REQUEST_DIAGNOSTIC',JSON.stringify({counts:[...s.counts],errors:s.errors}));
    invalid('CANVAS_UI_FIXTURE_REQUEST_VALIDATION');
  }
  const completed=[...s.completed].map(r=>r.url());
  const expectedCompleted=[...s.counts].filter(([k])=>k!=='/unexpected').flatMap(([k,n])=>Array.from({length:n},()=>ORIGIN+k));
  const failed=[...s.failed];
  console.log('RQ_POSITIVE_INPUT_RECEIPT',JSON.stringify({fixture:'EY',counts:s.counts.get('/api/task-events')??0,requests:[...s.responseStatus].filter(([request])=>request.url()===ORIGIN+'/api/task-events').map(([request,status])=>({status,finished:s.completed.has(request),failed:s.failed.has(request)}))}));
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















interface EYCase {theme:Theme;width:number;height:number;touch:boolean}
const eyCases:EYCase[]=[...THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height,touch:true}))),{theme:'mono',width:768,height:1024,touch:true},{theme:'gold',width:1024,height:768,touch:false}];
async function eyTap(s:Session,target:Locator):Promise<void>{await target.scrollIntoViewIfNeeded();if(s.options.touch)await target.tap();else await target.click();await settle(s.page);}
async function eyOpen(s:Session,e:EYCase,keyboard=false):Promise<Locator>{if(keyboard){await s.page.keyboard.press('Control+k');}else if(e.width<768){await eyTap(s,s.page.getByRole('button',{name:'全部工具',exact:true}));const drawer=s.page.locator('[data-mobile-canvas-toolbar-drawer]');await drawer.waitFor({state:'visible'});const entry=drawer.getByRole('button',{name:'命令面板',exact:true}),b=await entry.boundingBox();if(!b)throw Error('EY_ENTRY_RECT');if(e.touch){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}await eyTap(s,entry);await drawer.waitFor({state:'detached'});}else{const entry=s.page.locator('[data-toolbar="bottom-toolbar"]').getByTitle('命令面板 (Ctrl+K / Cmd+K)',{exact:true}),b=await entry.boundingBox();if(!b)throw Error('EY_ENTRY_RECT');if(e.touch){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}await eyTap(s,entry);}const root=s.page.getByRole('dialog',{name:'画布命令面板',exact:true});await root.waitFor({state:'visible'});await expect.poll(()=>root.getByRole('searchbox',{name:'搜索画布命令'}).evaluate(el=>document.activeElement===el),{timeout:1500}).toBe(true);return root;}
async function eyCapture(s:Session,e:EYCase,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-command-palette-ey-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,`${e.theme}-${e.width}x${e.height}-${label}.png`);await s.page.screenshot({path:file});console.log('EY_CAPTURE',JSON.stringify({path:file,notCloudOrPhysicalAndroid:true}));}
async function eyRunCommand(s:Session,e:EYCase,name:string,keyboard=false):Promise<void>{const root=await eyOpen(s,e,keyboard),input=root.getByRole('searchbox',{name:'搜索画布命令'});await input.fill(name);const target=root.locator('[data-command-index]');expect(await target.count()).toBe(1);if(keyboard)await input.press('Enter');else await eyTap(s,target);await root.waitFor({state:'detached'});await settle(s.page);}
for(const e of eyCases)it(`EY ${e.theme} ${e.width}x${e.height} command search navigation and close`,async()=>{await withSession(e.theme,e.width,e.height,{touch:e.touch},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);let root=await eyOpen(s,e);try{
 const input=root.getByRole('searchbox',{name:'搜索画布命令'}),rows=root.locator('[data-command-index]'),list=rows.first().locator('..'),dialogBox=await root.boundingBox(),listBox=await list.boundingBox(),font=await input.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),close=root.getByRole('button',{name:'关闭命令面板',exact:true});if(!dialogBox||!listBox)throw Error('EY_PALETTE_RECTS');const closeCount=await close.count(),controls=await rows.evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height};}));console.log('EY_LAYOUT',JSON.stringify({...e,dialogBox,listBox,font,closeCount,controls}));await eyCapture(s,e,'opened');
 expect.soft(dialogBox.x).toBeGreaterThanOrEqual(8);expect.soft(dialogBox.y).toBeGreaterThanOrEqual(8);expect.soft(dialogBox.x+dialogBox.width).toBeLessThanOrEqual(e.width-8);expect.soft(dialogBox.y+dialogBox.height).toBeLessThanOrEqual(e.height-8);expect.soft(await root.evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal crop').toBe(true);if(e.width<768){expect.soft(listBox.height,'short phone viewport still shows at least two complete command rows').toBeGreaterThanOrEqual(132);expect.soft(font,'phone search avoids undersized text').toBeGreaterThanOrEqual(16);}for(const b of controls){expect.soft(b.height,'actual command row touch height').toBeGreaterThanOrEqual(44);}expect.soft(closeCount,'touch user has an explicit close control').toBe(1);
 expect(await rows.count(),'only currently available original commands').toBe(10);expect(await root.getByRole('button',{name:/小地图/}).count(),'unavailable minimap stays absent for expanded sidebar fixture').toBe(0);await input.fill('  ZOOM  ');await settle(s.page);expect(await rows.count()).toBe(2);expect(await rows.allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('放大画布'),expect.stringContaining('缩小画布')]));await input.fill('不存在的命令'.repeat(20));await settle(s.page);expect(await rows.count()).toBe(0);expect(await root.getByText('没有匹配的命令',{exact:true}).isVisible()).toBe(true);for(const key of ['ArrowDown','ArrowUp','Enter'])await input.press(key);expect(await root.isVisible(),'empty result Enter never invokes a command or closes').toBe(true);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual(before.view);
 await input.fill('');await settle(s.page);await input.press('ArrowUp');const selected=rows.filter({has:s.page.locator(':scope[aria-current="true"]')});const last=rows.last();expect(await last.getAttribute('aria-current'),'up wraps to final version history item').toBe('true');await expect.poll(async()=>{const item=await last.boundingBox(),container=await list.boundingBox();return !!item&&!!container&&item.y>=container.y&&item.y+item.height<=container.y+container.height+.5;},{timeout:1500}).toBe(true);await input.press('ArrowDown');expect(await rows.first().getAttribute('aria-current'),'down wraps back to first reset item').toBe('true');expect(await rows.locator('[aria-current="true"]').count()).toBe(0);void selected;
 await input.press('Escape');await root.waitFor({state:'detached'});expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual(before.view);
 await eyRunCommand(s,e,'抓手工具',true);expect(await s.page.locator('[data-canvas-viewport]').evaluate(el=>getComputedStyle(el).cursor)).toBe('grab');await eyRunCommand(s,e,'选择工具',true);expect(await s.page.locator('[data-canvas-viewport]').evaluate(el=>getComputedStyle(el).cursor)).toBe('default');await eyRunCommand(s,e,'放大画布');await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view?.zoom),{timeout:1500}).toBe(1.2);await eyRunCommand(s,e,'缩小画布');await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view?.zoom),{timeout:1500}).toBe(1);
 root=await eyOpen(s,e,true);await root.getByRole('searchbox',{name:'搜索画布命令'}).press('Control+k');await root.waitFor({state:'detached'});root=await eyOpen(s,e);const explicit=root.getByRole('button',{name:'关闭命令面板',exact:true});expect(await explicit.count(),'explicit close required').toBe(1);const cb=await explicit.boundingBox();if(!cb)throw Error('EY_CLOSE_RECT');expect(cb.width).toBeGreaterThanOrEqual(44);expect(cb.height).toBeGreaterThanOrEqual(44);await eyTap(s,explicit);await root.waitFor({state:'detached'});root=await eyOpen(s,e,true);const rb=await root.boundingBox();if(!rb)throw Error('EY_BACKDROP_RECT');const outside={x:4,y:Math.max(4,Math.min(e.height-4,rb.y-4))};expect(await s.page.locator('[data-command-palette]').evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,outside),'native outside point lands on palette backdrop').toBe(true);if(e.touch)await s.page.touchscreen.tap(outside.x,outside.y);else await s.page.mouse.click(outside.x,outside.y);await root.waitFor({state:'detached'});
 const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.actions).toEqual(before.actions);expect(after.view).toEqual(before.view);console.log('EY_COMMAND_BODY',JSON.stringify({...e,searchAndEmpty:true,keyboardWrapAndTwoTools:true,zoomInOutLiteral1_2:true,explicitAndBackdropAndKeyboardClose:true,assetsGroupsViewActionsHeld:true,bodyNotGate:true}));
 }finally{if(await root.count())await eyCapture(s,e,'final');}});},25000);
for(const empty of [false,true])it(`EZ ${empty?'mono 640x320 empty':'gold 390x844 command'} focused close Enter never executes selection`,async()=>{const e:EYCase=empty?{theme:'mono',width:640,height:320,touch:true}:{theme:'gold',width:390,height:844,touch:true};await withSession(e.theme,e.width,e.height,{touch:true},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);const root=await eyOpen(s,e),input=root.getByRole('searchbox',{name:'搜索画布命令'}),close=root.getByRole('button',{name:'关闭命令面板',exact:true});try{await input.fill(empty?'EZ不存在的命令':'抓手工具');await settle(s.page);expect(await root.locator('[data-command-index]').count()).toBe(empty?0:1);await input.press('Tab');expect(await close.evaluate(el=>document.activeElement===el),'real Tab from search focuses close').toBe(true);await s.page.keyboard.press('Enter');await root.waitFor({state:'detached'});expect(await s.page.locator('[data-canvas-viewport]').evaluate(el=>getComputedStyle(el).cursor),'close must not activate hand command').toBe('default');const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.view).toEqual(before.view);expect(after.actions).toEqual(before.actions);const reopened=await eyOpen(s,e);const search=reopened.getByRole('searchbox',{name:'搜索画布命令'});await search.press('Tab');expect(await reopened.getByRole('button',{name:'关闭命令面板',exact:true}).evaluate(el=>document.activeElement===el)).toBe(true);await s.page.keyboard.press('Space');await reopened.waitFor({state:'detached'});expect(await s.page.locator('[data-canvas-viewport]').evaluate(el=>getComputedStyle(el).cursor)).toBe('default');console.log('EZ_CLOSE_KEYBOARD_BODY',JSON.stringify({empty,tabEnterAndSpace:true,noCommandExecuted:true,bodyNotGate:true}));}finally{if(await root.count())await eyCapture(s,e,'ez-keyboard-'+(empty?'empty':'command'));}});},25000);
