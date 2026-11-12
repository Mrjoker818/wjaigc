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
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;largeLayers?:boolean}
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
const bxDescriptor={providerId:'bx-provider',modelId:'bx-image',kind:'image' as const,sourceType:'image' as const,protocol:'openai',executionMode:'sync' as const,allowedRatios:['1:1','3:2'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:2,supportsVision:false,supportsReferenceImages:true,maxReferenceImages:14,supportsMask:false,allowedDurationsSeconds:[],maxDurationSeconds:0,supportedOperations:['image-to-image','multi-reference'] as Array<'image-to-image'|'multi-reference'>,outputKinds:['image'],capabilitySources:{allowedRatios:'admin' as const,allowedSizes:'admin' as const,qualityOptions:'admin' as const,supportsReferenceImages:'admin' as const,maxReferenceImages:'admin' as const}};
const bxUnsupported={...bxDescriptor,modelId:'bx-no-reference',supportsReferenceImages:false,maxReferenceImages:0};
const bySecond={...bxDescriptor,providerId:'by-provider-b',allowedRatios:['1:1','16:9'],allowedSizes:['1536x1024'],qualityOptions:['hd'],maxOutputs:1};
function Entry({theme,admin,catalogLoading,largeLayers}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean;largeLayers:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,x:112,y:116,width:80,height:80,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:224,y:136,width:64,height:64,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:400,y:120,width:64,height:64,name:'BW 保留',prompt:'BR组外素材'},...(largeLayers?Array.from({length:15},(_,index)=>({id:'cb-'+index,url:png,x:500+index*100,y:120,width:64,height:64,name:'CB 图层 '+(index+4),prompt:'CB 合成图层'})):[])]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/></>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean;largeLayers?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true} largeLayers={options.largeLayers===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
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








interface CBImage {id:string;name?:string;url:string;x:number;y:number;width:number;height:number;visible?:boolean;locked?:boolean}
const MATRIX=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
let captureIndex=0;
async function capture(s:Session,theme:Theme,width:number,height:number,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-layer-cb-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,theme+'-'+width+'x'+height+'-'+(++captureIndex)+'-'+label+'.png');await s.page.screenshot({path:file});console.log('CB_CAPTURE',JSON.stringify({path:file,label,coze:false,physicalAndroid:false,serverPersistence:false}));}
async function layers(s:Session):Promise<Locator>{await s.page.getByRole('button',{name:'全部工具',exact:true}).tap();await s.page.getByRole('dialog',{name:'全部工具',exact:true}).getByRole('button',{name:'图层面板',exact:true}).tap();const panel=s.page.locator('[data-popup="layer-panel"]');await panel.waitFor();return panel;}
async function rename(panel:Locator,name:string,mobile=true):Promise<Locator>{const card=panel.getByTitle(name,{exact:true});const opener=card.getByRole('button',{name:/更多操作$/});await opener.scrollIntoViewIfNeeded();if(mobile)await opener.tap();else await opener.click();const action=panel.getByRole('button',{name:'重命名',exact:true});if(mobile)await action.tap();else await action.click();const input=card.getByRole('textbox'),immediate=await input.count();await input.waitFor({state:'visible'});console.log('CB_RENAME_READY',JSON.stringify({name,mobile,immediate,ready:await input.count(),visible:await input.isVisible(),sameOriginalPageTimeoutMs:1500}));return card;}
async function touchMove(s:Session,x:number,y:number,dx:number,dy:number):Promise<void>{const c=await s.context.newCDPSession(s.page);try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(const t of [.25,.5,.75,1]){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*t,y:y+dy*t,id:1}]});await settle(s.page);}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(s.page);}finally{await c.detach();}}
async function stablePublicState(s:Session,before:FixtureWindow['canvasUi']['state']):Promise<void>{await s.page.evaluate(async original=>{const until=performance.now()+600;while(performance.now()<until){const now=(window as unknown as FixtureWindow).canvasUi.state;for(const key of ['images','groups','view','actions'] as const)if(JSON.stringify(now[key])!==JSON.stringify(original[key]))throw Error('CB_NATIVE_SCROLL_CHANGED_PUBLIC_'+key);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}},before);}
async function contrast(control:Locator,label:string):Promise<void>{const v=await control.evaluate(el=>{const svg=el.querySelector('svg');if(!svg)throw Error('CB_ICON_REQUIRED');const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('CB_COLOR_CANVAS_REQUIRED');type Color=[number,number,number,number];const color=(css:string):Color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return [p[0],p[1],p[2],p[3]/255];};const over=(f:Color,b:Color):Color=>{const alpha=f[3]+b[3]*(1-f[3]);return alpha?[(f[0]*f[3]+b[0]*b[3]*(1-f[3]))/alpha,(f[1]*f[3]+b[1]*b[3]*(1-f[3]))/alpha,(f[2]*f[3]+b[2]*b[3]*(1-f[3]))/alpha,alpha]:[0,0,0,0];};const stack:Color[]=[];for(let n:Element|null=el;n;n=n.parentElement){const c=getComputedStyle(n);if(Number(c.opacity)!==1)throw Error('CB_UNSUPPORTED_GROUP_OPACITY');if(c.backgroundImage!=='none')throw Error('CB_UNSUPPORTED_BACKGROUND_IMAGE');const bg=color(c.backgroundColor);stack.push(bg);if(bg[3]===1)break;}let bg:Color=[255,255,255,1];for(const c of stack.reverse())bg=over(c,bg);const fg=over(color(getComputedStyle(svg).color),bg),luminance=(c:Color):number=>{const linear=c.slice(0,3).map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];},a=luminance(fg),b=luminance(bg),r=el.getBoundingClientRect(),icon=svg.getBoundingClientRect();return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),foreground:fg,background:bg,width:r.width,height:r.height,iconWidth:icon.width,iconHeight:icon.height,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});console.log('CB_CONTRAST',JSON.stringify({label,...v}));expect.soft(v.ratio,label+' functional icon contrast').toBeGreaterThanOrEqual(3);expect.soft(v.iconWidth,label+' legible mobile icon').toBeGreaterThanOrEqual(16);expect.soft(v.iconHeight).toBeGreaterThanOrEqual(16);expect(v.width).toBeGreaterThanOrEqual(44);expect(v.height).toBeGreaterThanOrEqual(44);expect(v.hit).toBe(true);}
for(const e of MATRIX)it('CB '+e.theme+' '+e.width+'x'+e.height+' blank rename can reopen without modifying original name',async()=>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{try{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state),panel=await layers(s);let card=await rename(panel,'BW A');await card.getByRole('textbox').fill('   ');await card.getByRole('button',{name:'保存重命名',exact:true}).tap();await settle(s.page);expect(await card.getByRole('textbox').count()).toBe(0);expect((await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images) as CBImage[])).toEqual(before.images);card=await rename(panel,'BW A');expect.soft(await card.getByRole('textbox').count(),'blank submit must allow same layer editing again').toBe(1);if(await card.getByRole('textbox').count()!==1)return;await card.getByRole('textbox').fill('CB 再次编辑');await card.getByRole('button',{name:'保存重命名',exact:true}).tap();await settle(s.page);expect((await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images) as CBImage[]).find(i=>i.id==='br-A')?.name).toBe('CB 再次编辑');card=await rename(panel,'CB 再次编辑');await card.getByRole('textbox').fill('');await card.getByRole('button',{name:'取消重命名',exact:true}).tap();await settle(s.page);expect((await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images) as CBImage[]).find(i=>i.id==='br-A')?.name).toBe('CB 再次编辑');console.log('CB_BLANK_REOPEN',JSON.stringify({...e,originalNamePreservedOnBlank:true,reopenAndNonemptySave:true,emptyCancelNoWrite:true,noGeneration:true}));}finally{await capture(s,e.theme,e.width,e.height,'blank-reopen');}});},25000);
for(const theme of THEMES)it('CB '+theme+' desktop Escape rename can reopen same layer without saving draft',async()=>{await withSession(theme,390,844,{touch:true},async s=>{try{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state),panel=await layers(s);await s.page.setViewportSize({width:1024,height:768});await settle(s.page);let card=await rename(panel,'BW A',false);await card.getByRole('textbox').fill('CB 不应保存');await card.getByRole('textbox').press('Escape');await settle(s.page);expect(await card.getByRole('textbox').count()).toBe(0);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images)).toEqual(before.images);card=await rename(panel,'BW A',false);expect.soft(await card.getByRole('textbox').count(),'Escape must clear same-layer rename trigger').toBe(1);if(await card.getByRole('textbox').count()!==1)return;await card.getByRole('textbox').fill('CB 桌面确认');await card.getByRole('textbox').press('Enter');await settle(s.page);expect((await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images) as CBImage[]).find(i=>i.id==='br-A')?.name).toBe('CB 桌面确认');console.log('CB_ESCAPE_REOPEN',JSON.stringify({theme,desktopOnly:true,draftNotSaved:true,reopenThenSave:true,noGeneration:true}));}finally{await capture(s,theme,1024,768,'escape-reopen');}});},25000);
for(const e of MATRIX)it('CB '+e.theme+' '+e.width+'x'+e.height+' functional visibility and locked icon contrast after native toggles',async()=>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{try{const panel=await layers(s),card=panel.getByTitle('BW A',{exact:true}),visibility=card.getByRole('button',{name:/^(隐藏|显示)图层$/}),lock=card.getByRole('button',{name:/^(锁定|解锁)图层$/});await visibility.scrollIntoViewIfNeeded();await contrast(visibility,'visible');await visibility.tap();await settle(s.page);await contrast(visibility,'hidden');await visibility.tap();await lock.tap();await settle(s.page);await contrast(lock,'locked');await lock.tap();await settle(s.page);await contrast(lock,'unlocked');console.log('CB_CONTRAST_COMPLETED',JSON.stringify({...e,nativeStates:['visible','hidden','locked','unlocked'],backgroundModel:'computed solid backgrounds and opacity1 only',wholeAAAccepted:false}));}finally{await capture(s,e.theme,e.width,e.height,'contrast');}});},25000);
for(const e of MATRIX)it('CB '+e.theme+' '+e.width+'x'+e.height+' native layer horizontal scroll reaches eighteenth synthetic layer without canvas pan',async()=>{await withSession(e.theme,e.width,e.height,{touch:true,largeLayers:true},async s=>{try{await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).not.toBeNull();const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state),panel=await layers(s),scroll=panel.locator('.overflow-x-auto');expect(before.images).toHaveLength(18);const g=await scroll.boundingBox();if(!g)throw Error('CB_SCROLL_RECT');const max=await scroll.evaluate(el=>el.scrollWidth-el.clientWidth);expect(max).toBeGreaterThan(100);let attempts=0;while(await scroll.evaluate(el=>el.scrollLeft)<max-2&&attempts<12){await touchMove(s,g.x+g.width-24,g.y+Math.min(g.height/2,30),-(g.width-48),0);attempts++;}const left=await scroll.evaluate(el=>el.scrollLeft);expect(left,'native horizontal reaches final layer').toBeGreaterThanOrEqual(max-2);await stablePublicState(s,before);const last=panel.getByTitle('BW A',{exact:true}),thumb=last.locator('img');const endpoint=await thumb.evaluate(el=>{const r=el.getBoundingClientRect(),scroller=el.closest('.overflow-x-auto');if(!scroller)throw Error('CB_ENDPOINT_SCROLL_PARENT');const bounds=scroller.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,parentLeft:bounds.left,parentTop:bounds.top,parentRight:bounds.right,parentBottom:bounds.bottom,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),insideViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};});expect(endpoint.insideViewport&&endpoint.hit,'real final thumbnail directly hittable before any auto-scroll').toBe(true);expect(endpoint.x).toBeGreaterThanOrEqual(endpoint.parentLeft);expect(endpoint.y).toBeGreaterThanOrEqual(endpoint.parentTop);expect(endpoint.right).toBeLessThanOrEqual(endpoint.parentRight);expect(endpoint.bottom).toBeLessThanOrEqual(endpoint.parentBottom);await thumb.tap();await settle(s.page);expect(await last.locator('.ring-2').count()).toBe(1);expect(Math.abs(await scroll.evaluate(el=>el.scrollLeft)-left),'click must not auto-scroll back to display first item').toBeLessThan(.5);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images)).toEqual(before.images);console.log('CB_SCROLL_HORIZONTAL',JSON.stringify({...e,attempts,left,max,actualLastImageId:'br-A',displayOrder:'descending-z-index',endpoint,nativeEndpointVerified:true,all18Reachable:true,lastSelectedByNativeTouch:true,publicViewStableWindowMs:600,noGeneration:true,serverPersistence:false}));}finally{await capture(s,e.theme,e.width,e.height,'horizontal-scroll');}});},25000);
for(const theme of THEMES)it('CB '+theme+' 640x320 native layer vertical scroll crosses controls without toggling or canvas pan',async()=>{await withSession(theme,640,320,{touch:true,largeLayers:true},async s=>{try{await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).not.toBeNull();const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state),panel=await layers(s),scroll=panel.locator('.overflow-x-auto'),g=await scroll.boundingBox();if(!g)throw Error('CB_VERTICAL_RECT');const max=await scroll.evaluate(el=>el.scrollHeight-el.clientHeight);expect(max).toBeGreaterThan(20);await touchMove(s,g.x+g.width/2,g.y+g.height-16,0,-60);const top=await scroll.evaluate(el=>el.scrollTop);expect(top).toBeGreaterThan(10);await stablePublicState(s,before);expect(await panel.locator('.ring-2').count()).toBe(0);console.log('CB_SCROLL_VERTICAL',JSON.stringify({theme,width:640,height:320,top,max,publicViewStableWindowMs:600,imagesAndGroupsUntouched:true,noGeneration:true,serverPersistence:false}));}finally{await capture(s,theme,640,320,'vertical-scroll');}});},25000);
