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















interface EFEntry {theme:Theme;width:number;height:number;variant:'controls'|'escape'|'mouse'|'multi'|'touch'|'cancel'}
const efMatrix:EFEntry[]=THEMES.flatMap<EFEntry>(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height,variant:'controls' as const}))).concat(THEMES.map(theme=>({theme,width:375,height:812,variant:'escape' as const})),[{theme:'gold',width:1024,height:768,variant:'mouse'}],THEMES.map(theme=>({theme,width:390,height:844,variant:'multi' as const})),[{theme:'gold',width:390,height:844,variant:'touch'},{theme:'mono',width:390,height:844,variant:'cancel'}]);
async function efCapture(s:Session,e:EFEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-hex-cube-eg-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+e.variant+'-'+label+'.png');await s.page.screenshot({path:file});console.log('EG_CAPTURE',JSON.stringify({path:file,label,offlineNotDeviceAcceptance:true}));}
async function efTap(s:Session,c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();if(s.options.touch)await c.tap();else await c.click();await settle(s.page);}
async function egAudit(root:Locator):Promise<void>{const faults:Array<Record<string,unknown>>=[];for(const c of await root.locator('button,input,select,textarea,[role="button"]').all()){await c.scrollIntoViewIfNeeded();const v=await c.evaluate(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});if(v.width<44||v.height<44||!v.inside||!v.hit||!v.name)faults.push(v);}console.log('EG_CONTROL_AUDIT',JSON.stringify({faults}));expect.soft(faults,'44px named visible actual controls, scroll preparation not finger proof').toEqual([]);}
async function egScroll(s:Session,root:Locator):Promise<void>{const body=root.locator('[data-hex-cube-body]');await root.getByText('产品六面展开图',{exact:true}).scrollIntoViewIfNeeded();const before=await body.evaluate(el=>el.scrollTop),b=await body.boundingBox();if(!b)throw Error('EG_REAL_BODY_REQUIRED');const cdp=await s.context.newCDPSession(s.page),x=b.x+b.width-8,y=b.y+b.height*.7;let active=false;try{expect(await body.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),{x,y})).toBe(true);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,force:1}]});active=true;for(const d of [15,30,45,60]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-d,id:1,force:1}]});await settle(s.page);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;}finally{try{if(active)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await cdp.detach();}}await expect.poll(()=>body.evaluate(el=>el.scrollTop),{timeout:1500,message:'actual native finger scroll reaches lower controls'}).toBeGreaterThan(before+20);}
async function egRange(s:Session,c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();const b=await c.boundingBox();if(!b)throw Error('EG_RANGE_BOUNDS');await c.tap({position:{x:b.width*.75,y:b.height/2}});await settle(s.page);}
async function eiGesture(s:Session,root:Locator,cancel:boolean):Promise<void>{const preview=root.locator('[style*="perspective: 600px"]'),cube=preview.locator('[style*="transform-style: preserve-3d"]'),hint=preview.locator(':scope > div').last();await preview.scrollIntoViewIfNeeded();const r=await preview.boundingBox();if(!r)throw Error('EI_REAL_PREVIEW_REQUIRED');const start={x:r.x+r.width/2,y:r.y+r.height/2},cdp=await s.context.newCDPSession(s.page);let active=false,mouseActive=false;try{expect(await preview.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return Boolean(hit&&el.contains(hit)&&!hit.closest('button,[role="button"]'));},start),'actual preview center is separate from upload cells and buttons').toBe(true);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,force:1}]});active=true;expect(['DIV','SPAN'],'native touch actually begins on preview content rather than neighboring button').toContain(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.events.filter(e=>e.type==='pointerdown').at(-1)?.target));for(const f of [.5,1]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+30*f,y:start.y+20*f,id:1,force:1}]});await settle(s.page);}await expect.poll(()=>hint.textContent(),{timeout:1500,message:'native primary finger visibly rotates cube before negative comparisons'}).toBe('15° / +8°');if(!cancel){const baseline=await hint.textContent();await s.page.mouse.move(start.x-30,start.y-20);await s.page.mouse.down();mouseActive=true;await s.page.mouse.move(start.x-10,start.y-10,{steps:2});await s.page.mouse.up();mouseActive=false;await settle(s.page);expect(await hint.textContent(),'unrelated mouse cannot move owned touch camera at this readpoint').toBe(baseline);expect(await cube.evaluate(el=>(el as HTMLElement).style.transition),'mouse up cannot clear owned touch feedback').toBe('none');}for(const f of [.5,1]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+30+30*f,y:start.y+20+20*f,id:1,force:1}]});await settle(s.page);}await expect.poll(()=>hint.textContent(),{timeout:1500}).toBe('30° / +16°');await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});active=false;await settle(s.page);if(cancel){await preview.scrollIntoViewIfNeeded();const b=await preview.boundingBox();if(!b)throw Error('EI_SECOND_REAL_BOUNDS');const x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:2,force:1}]});active=true;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+20,y:y-20,id:2,force:1}]});await expect.poll(()=>hint.textContent(),{timeout:1500,message:'fresh finger after cancel uses current camera, no stale owner'}).toBe('40° / +8°');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;}else{const b=await preview.boundingBox();if(!b)throw Error('EI_MOUSE_AFTER_TOUCH_BOUNDS');await s.page.mouse.move(b.x+b.width/2,b.y+b.height/2);await s.page.mouse.down();mouseActive=true;await s.page.mouse.move(b.x+b.width/2+20,b.y+b.height/2+10,{steps:3});await s.page.mouse.up();mouseActive=false;await expect.poll(()=>hint.textContent(),{timeout:1500,message:'existing mouse remains usable after touch release'}).toBe('40° / +20°');}console.log('EI_GESTURE_BODY',JSON.stringify({cancel,nativeTouch:true,mixedReadpoints:!cancel,freshTouchAfterCancel:cancel,normalMouseAfterRelease:!cancel,notContinuousTimeAbsenceProof:true}));}finally{try{if(mouseActive)await s.page.mouse.up();if(active)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await cdp.detach();}}}
for(const e of efMatrix)it('EF '+e.theme+' '+e.width+'x'+e.height+' '+e.variant+' actual hex cube mobile operations',async()=>{await withSession(e.theme,e.width,e.height,{touch:e.variant!=='mouse'},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);try{if(e.variant==='mouse'){await efTap(s,s.page.getByRole('button',{name:'全部工具',exact:true}));await efTap(s,s.page.locator('[data-bottom-toolbar-drawer]').getByTitle('六面体',{exact:true}));}else{await efTap(s,s.page.getByRole('button',{name:'全部工具',exact:true}));await efTap(s,s.page.locator('[data-mobile-canvas-toolbar-drawer]').getByRole('button',{name:'六面体',exact:true}));}const root=s.page.locator('[data-hex-cube-panel]');await root.waitFor();await nativeRequestsFinished(s);await efCapture(s,e,'opened');const bounds=await root.boundingBox();console.log('EG_BOUNDS',JSON.stringify({...e,bounds}));expect.soft(Boolean(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=e.width&&bounds.y+bounds.height<=e.height),'six-face window fully inside viewport').toBe(true);expect.soft(await root.getAttribute('role'),'named nonmodal tool region avoids changing global overlay safety filters').toBe('region');expect.soft(await root.getAttribute('aria-label')).toBe('六面体工具');expect(await root.locator('div.grid[style*="grid-template-columns"] > div').count(),'six public empty texture cells').toBe(6);const close=root.getByTitle('关闭',{exact:true}),prompt=root.getByLabel('六面体提示词',{exact:true}),rotation=root.getByLabel('六面体旋转',{exact:true}),tilt=root.getByLabel('六面体倾斜',{exact:true});
if(e.variant==='multi'){const first=await root.getAttribute('data-hex-cube-panel');if(!first)throw Error('EG_PUBLIC_FIRST_ID');await prompt.fill('第一个窗口');await efTap(s,root.getByTitle('折叠',{exact:true}));await efTap(s,s.page.getByRole('button',{name:'全部工具',exact:true}));await efTap(s,s.page.locator('[data-mobile-canvas-toolbar-drawer]').getByRole('button',{name:'六面体',exact:true}));await expect.poll(()=>root.getAttribute('data-hex-cube-panel'),{timeout:1500}).not.toBe(first);expect(await root.count()).toBe(1);const second=await root.getAttribute('data-hex-cube-panel');if(!second)throw Error('EG_PUBLIC_SECOND_ID');const windows=root.getByLabel('切换六面体窗口',{exact:true});expect(await windows.locator('option').count()).toBe(2);expect(await prompt.inputValue()).toBe('');await prompt.fill('第二个窗口');await windows.selectOption(first);await root.getByTitle('展开',{exact:true}).waitFor();await efTap(s,root.getByTitle('展开',{exact:true}));expect(await prompt.inputValue()).toBe('第一个窗口');await windows.selectOption(second);expect(await prompt.inputValue()).toBe('第二个窗口');await efTap(s,close);await expect.poll(()=>root.getAttribute('data-hex-cube-panel'),{timeout:1500}).toBe(first);expect(await prompt.inputValue()).toBe('第一个窗口');expect(await windows.count()).toBe(0);await efCapture(s,e,'multi-preserved');await efTap(s,close);await root.waitFor({state:'detached'});}
else if(e.variant==='escape'){await prompt.focus();expect(await prompt.evaluate(el=>document.activeElement===el)).toBe(true);await s.page.keyboard.press('Escape');await root.waitFor({state:'detached'});}
else if(e.variant==='touch'||e.variant==='cancel'){await eiGesture(s,root,e.variant==='cancel');await efCapture(s,e,'gesture-operations');await efTap(s,close);await root.waitFor({state:'detached'});}
else if(e.variant==='mouse'){const preview=root.locator('[style*="perspective: 600px"]');await preview.scrollIntoViewIfNeeded();const b=await preview.boundingBox();if(!b)throw Error('EG_MOUSE_PREVIEW');await s.page.mouse.move(b.x+b.width*.4,b.y+b.height*.4);await s.page.mouse.down();try{await s.page.mouse.move(b.x+b.width*.4+60,b.y+b.height*.4+40,{steps:6});await expect.poll(async()=>Number(await rotation.inputValue()),{timeout:1500}).toBeGreaterThan(20);await expect.poll(async()=>Number(await tilt.inputValue()),{timeout:1500}).toBeGreaterThan(10);}finally{await s.page.mouse.up();}const title=root.getByText('六面体',{exact:true}),t=await title.boundingBox(),r=await root.boundingBox();if(!t||!r)throw Error('EG_MOUSE_HEADER');const headerStart={x:Math.round(t.x+t.width/2),y:Math.round(t.y+t.height/2)};await s.page.mouse.move(headerStart.x,headerStart.y);await s.page.mouse.down();try{await s.page.mouse.move(headerStart.x+24,headerStart.y+16,{steps:5});await settle(s.page);}finally{await s.page.mouse.up();}await expect.poll(async()=>(await root.boundingBox())!.x,{timeout:1500}).toBeCloseTo(r.x+24,0);await expect.poll(async()=>(await root.boundingBox())!.y,{timeout:1500}).toBeCloseTo(r.y+16,0);await efTap(s,root.getByTitle('折叠',{exact:true}));const collapsed=await root.boundingBox(),collapsedTitle=await title.boundingBox();if(!collapsed||!collapsedTitle)throw Error('EI_COLLAPSED_HEADER_BOUNDS');const collapsedStart={x:Math.round(collapsedTitle.x+collapsedTitle.width/2),y:Math.round(collapsedTitle.y+collapsedTitle.height/2)};await s.page.mouse.move(collapsedStart.x,collapsedStart.y);await s.page.mouse.down();try{await s.page.mouse.move(collapsedStart.x+24,collapsedStart.y+16,{steps:5});await settle(s.page);}finally{await s.page.mouse.up();}await expect.poll(async()=>(await root.boundingBox())!.x,{timeout:1500,message:'collapsed header remains draggable'}).toBeCloseTo(collapsed.x+24,0);await expect.poll(async()=>(await root.boundingBox())!.y,{timeout:1500}).toBeCloseTo(collapsed.y+16,0);await efTap(s,root.getByTitle('展开',{exact:true}));await efCapture(s,e,'mouse-operations');await efTap(s,close);await root.waitFor({state:'detached'});}
else {await egAudit(root);await egScroll(s,root);const resolution=root.getByLabel('六面体分辨率',{exact:true}),quality=root.getByLabel('六面体质量',{exact:true}),ratio=root.getByLabel('六面体比例',{exact:true}),count=root.getByLabel('六面体生成数量',{exact:true});expect.soft(await resolution.inputValue(),'initial model catalog default resolution').toBe('1024x1024');expect.soft(await quality.inputValue(),'initial model catalog default quality').toBe('standard');await egRange(s,rotation);await expect.poll(async()=>Number(await rotation.inputValue()),{timeout:1500}).toBeGreaterThan(230);expect(Number(await rotation.inputValue())).toBeLessThan(310);await egRange(s,tilt);await expect.poll(async()=>Number(await tilt.inputValue()),{timeout:1500}).toBeGreaterThan(15);expect(Number(await tilt.inputValue())).toBeLessThan(45);for(const name of ['特写','广角','标准']){const zoom=root.getByRole('button',{name,exact:true});await efTap(s,zoom);expect(await zoom.getAttribute('aria-pressed')).toBe('true');}await count.selectOption('2');expect(await count.inputValue()).toBe('2');const model=root.getByRole('button',{name:'六面体生图模型',exact:true});await efTap(s,model);const menu=root.locator('[data-popup="hex-cube-model"]');expect(await menu.getByRole('button').count()).toBe(3);const second=menu.getByRole('button').filter({hasText:'BY 合成供应商乙'});await efTap(s,second);expect(await model.textContent()).toContain('BY 合成供应商乙');await expect.poll(()=>count.inputValue(),{timeout:1500,message:'provider max1 reconciles previous count2'}).toBe('1');await efTap(s,model);await efTap(s,menu.getByRole('button').filter({hasText:'BX 图像 · 来自 BX 合成供应商'}));expect(await count.inputValue(),'return A does not resurrect count2').toBe('1');await efTap(s,model);await efTap(s,second);expect(await count.inputValue()).toBe('1');expect(await resolution.inputValue()).toBe('1536x1024');expect(await quality.inputValue()).toBe('hd');await ratio.selectOption('16:9');expect(await ratio.inputValue()).toBe('16:9');await efTap(s,model);expect(await second.getAttribute('aria-pressed')).toBe('true');await efTap(s,model);expect(await root.getByRole('button',{name:'一键优化',exact:true}).isDisabled()).toBe(true);await prompt.fill('本地六面体界面验收，不生成');expect(await root.getByRole('button',{name:'一键优化',exact:true}).isEnabled()).toBe(true);await efTap(s,root.getByTitle('折叠',{exact:true}));expect(await prompt.count()).toBe(0);await egAudit(root);await efTap(s,root.getByTitle('展开',{exact:true}));expect(await prompt.inputValue()).toBe('本地六面体界面验收，不生成');expect(await model.textContent()).toContain('BY 合成供应商乙');await efCapture(s,e,'operations');await efTap(s,close);await root.waitFor({state:'detached'});}
const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('EG_BODY',JSON.stringify({...e,actualParentEntry:true,noUploadOptimizationGenerationOrProvider:true,bodyReachedNotGate:true}));}finally{await efCapture(s,e,'end-or-failure');}});},25000);
