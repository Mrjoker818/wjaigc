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
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean; videoSubmit?: (request: Request) => Promise<{ status: number; json: Record<string, unknown> }>}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number}
const ORIGIN='https://canvas-shell-mobile.invalid';
const VIDEO_SUBMIT_PATHS = ['/api/video/generate', '/api/video/extend'];
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
function Entry({theme,admin,catalogLoading,videoSubmission}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean;videoSubmission:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,mediaType:'video' as const,videoUrl:"data:video/mp4;base64,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",videoDuration:1,x:40,y:120,width:240,height:135,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:270,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <>{!videoSubmission && <OperationAuditClient/>}<InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onRequestTaskPoll={async ({taskId}) => {
   if (!videoSubmission || typeof taskId !== 'string' || !taskId.startsWith('dj-synthetic-')) throw Error('DJ_UNEXPECTED_POLL');
   const clip = images.find(image => image.id === 'br-A');
   state.actions.push(taskId);
   return Response.json({status:'completed', imageUrl:clip?.videoUrl, videoUrl:clip?.videoUrl, videoThumbnailUrl:png});
 }}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/></>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean;videoSubmission?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true} videoSubmission={options.videoSubmission===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
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
        if (url.origin !== ORIGIN || url.username || url.password
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (options.videoSubmit && VIDEO_SUBMIT_PATHS.includes(key)) {
          if (request.method() !== 'POST' || headers['content-type'] !== 'application/json' || count > 3) throw Error('DJ_SUBMIT_BOUNDARY');
          await route.fulfill(await options.videoSubmit(request));
          return;
        }
        if (request.method() !== 'GET' || request.postData() !== null) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
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
    await page.evaluate(v => (window as unknown as FixtureWindow).canvasUi.mount(v.theme,v.options), {
      theme, options: { admin: options.admin, catalogLoading: options.catalogLoading, videoSubmission: Boolean(options.videoSubmit) },
    }); s.mounted = true;
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
  if (s.options.videoSubmit) allowed.push(...VIDEO_SUBMIT_PATHS);
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











interface DJEntry {theme:Theme;width:number;height:number;entry:'edit'|'extend';escape?:boolean}
const djMatrix:DJEntry[]=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].flatMap(([width,height])=>(['edit','extend'] as const).map(entry=>({theme,width,height,entry})))).concat(THEMES.map(theme=>({theme,width:375,height:812,entry:'extend' as const,escape:true})));
async function djCapture(s:Session,e:DJEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-video-edit-dj-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+e.entry+'-'+(e.escape?'escape-':'')+label+'.png');await s.page.screenshot({path:file});console.log('DJ_CAPTURE',JSON.stringify({path:file,label,notAndroidCloudOrPaidAcceptance:true}));}
async function djTap(s:Session,c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();await c.tap();await settle(s.page);}
async function djAudit(c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();const v=await c.evaluate(el=>{const r=el.getBoundingClientRect(),faults:string[]=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.left<r.left-.5||b.right>r.right+.5||b.top<r.top-.5||b.bottom>r.bottom+.5)faults.push('text-clipped');}return {name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),faults};});console.log('DJ_CONTROL',JSON.stringify(v));expect.soft(v.width,'touch width '+v.name).toBeGreaterThanOrEqual(44);expect.soft(v.height,'touch height '+v.name).toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,'visible '+v.name).toBe(true);expect.soft(v.name,'accessible purpose').not.toBe('');expect.soft(v.faults,'readable '+v.name).toEqual([]);}
async function djOpen(s:Session,e:DJEntry):Promise<Locator>{const c=await s.context.newCDPSession(s.page);let active=false;try{expect(await s.page.evaluate(()=>Boolean(document.elementFromPoint(128,198)?.closest('[data-canvas-image-id="br-A"]')))).toBe(true);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:128,y:198,id:1,force:1}]});active=true;await s.page.locator('[data-popup="context-menu"]').waitFor({state:'visible'});await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;}finally{try{if(active)await c.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await c.detach();}}await djTap(s,s.page.locator('[data-popup="context-menu"]').getByRole('button',{name:e.entry==='extend'?'视频延长':'视频编辑',exact:true}));const root=s.page.locator('div.fixed[class~="z-[250]"]').filter({has:s.page.getByRole('heading',{name:'视频编辑',exact:true})});await root.waitFor({state:'visible'});return root;}
async function djMedia(v:Locator):Promise<{duration:number;time:number;frames:number;paused:boolean;muted:boolean;width:number;height:number;inline:boolean;error:number|null}>{return v.evaluate(el=>{const video=el as HTMLVideoElement;return {duration:video.duration,time:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames,paused:video.paused,muted:video.muted,width:video.videoWidth,height:video.videoHeight,inline:video.playsInline,error:video.error?.code??null};});}

function djState(s: Session) {
  return s.page.evaluate(() => (window as unknown as FixtureWindow).canvasUi.state);
}

async function expectCompletedEdit(s: Session, entry: DJEntry['entry'], prompt: string) {
  await expect.poll(async () => {
    const { images } = await djState(s);
    return images.find((image): image is { id: string } =>
      typeof image === 'object' && image !== null && 'id' in image
      && typeof image.id === 'string' && image.id.startsWith(`processing-video-${entry}-`),
    );
  }, { timeout: 5000 }).toMatchObject({
    isProcessing: false, mediaType: 'video', generatedFromImageId: 'br-A', relationType: 'edit', prompt,
  });
}

it.each(['edit', 'extend'] as const)('DJ submission %s preserves its draft after rejection and completes an accepted retry', async entry => {
  const e: DJEntry = { theme: 'gold', width: 390, height: 844, entry };
  const path = entry === 'edit' ? VIDEO_SUBMIT_PATHS[0] : VIDEO_SUBMIT_PATHS[1];
  const prompt = `DJ synthetic ${entry} draft`;
  const taskId = `dj-synthetic-${entry}`;
  const error = entry === 'edit' ? '离线测试拒绝编辑' : '视频延长请求未受理，请重试';
  let requests = 0;
  await withSession(e.theme, e.width, e.height, {
    touch: true,
    videoSubmit: async request => {
      expect(new URL(request.url()).pathname).toBe(path);
      const body = request.postDataJSON();
      expect(body).toMatchObject(entry === 'edit'
        ? { prompt, mode: 'image2video', imageUrl: expect.stringMatching(/^data:image\/png;base64,/) }
        : { prompt, extendDuration: 10, videoUrl: expect.stringMatching(/^data:video\/mp4;base64,/) });
      requests += 1;
      if (requests === 1) {
        return entry === 'edit'
          ? { status: 422, json: { error, taskId: 'dj-synthetic-refused' } }
          : { status: 200, json: { success: true } };
      }
      return { status: 200, json: { taskId } };
    },
  }, async s => {
    const before = await djState(s);
    const dialog = await djOpen(s, e);
    const field = dialog.getByRole('textbox');
    const submit = dialog.getByRole('button', { name: entry === 'edit' ? '应用编辑' : '延长视频', exact: true });
    await field.fill(prompt);
    if (entry === 'extend') await djTap(s, dialog.getByRole('button', { name: '+10秒' }));
    const rejected = s.page.waitForResponse(ORIGIN + path);
    await djTap(s, submit);
    await rejected;
    await settle(s.page);
    expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.getByRole('alert').textContent()).toBe(error);
    expect(await field.inputValue()).toBe(prompt);
    expect((await djState(s)).images).toEqual(before.images);

    await djTap(s, submit);
    await dialog.waitFor({ state: 'detached' });
    await expectCompletedEdit(s, entry, prompt);
    const after = await djState(s);
    expect(after.actions).toEqual([taskId]);
    expect(after.images.slice(0, before.images.length)).toEqual(before.images);
    expect(requests).toBe(2);
  });
}, 25000);

it('DJ submission late acceptance completes the original task without closing the reopened editor', async () => {
  const e: DJEntry = { theme: 'gold', width: 390, height: 844, entry: 'edit' };
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const taskId = 'dj-synthetic-late';
  const prompt = 'DJ older request';
  await withSession(e.theme, e.width, e.height, {
    touch: true,
    videoSubmit: async request => {
      expect(new URL(request.url()).pathname).toBe(VIDEO_SUBMIT_PATHS[0]);
      expect(request.postDataJSON()).toMatchObject({ prompt });
      await hold;
      return { status: 200, json: { taskId } };
    },
  }, async s => {
    try {
      const original = await djOpen(s, e);
      await original.getByRole('textbox').fill(prompt);
      const sent = s.page.waitForRequest(ORIGIN + VIDEO_SUBMIT_PATHS[0]);
      await djTap(s, original.getByRole('button', { name: '应用编辑', exact: true }));
      await sent;
      await s.page.keyboard.press('Escape');
      await original.waitFor({ state: 'detached' });
      const replacement = await djOpen(s, { ...e, entry: 'extend' });
      await replacement.getByRole('textbox').fill('DJ replacement draft');
      const response = s.page.waitForResponse(ORIGIN + VIDEO_SUBMIT_PATHS[0]);
      release();
      await response;
      await settle(s.page);
      expect(await replacement.isVisible()).toBe(true);
      expect(await replacement.getByRole('textbox').inputValue()).toBe('DJ replacement draft');
      await expectCompletedEdit(s, 'edit', prompt);
      expect(await replacement.getByRole('textbox').inputValue()).toBe('DJ replacement draft');
      expect((await djState(s)).actions).toEqual([taskId]);
    } finally {
      release();
    }
  });
}, 25000);

for(const e of djMatrix)it('DJ '+e.theme+' '+e.width+'x'+e.height+' '+e.entry+(e.escape?' escape':'')+' actual parent mobile video edit and extend controls',async()=>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);try{const root=await djOpen(s,e),panel=root.locator('>div'),video=root.locator('video');await expect.poll(async()=>(await djMedia(video)).width,{timeout:1500,message:'owned clip really decoded in edit panel'}).toBe(160);const initial=await djMedia(video);expect(initial.duration).toBe(1);expect(initial.height).toBe(90);expect(initial.error).toBe(null);expect.soft(initial.inline,'mobile preview plays inline').toBe(true);expect.soft(await root.getAttribute('role'),'video edit dialog').toBe('dialog');expect.soft(await root.getAttribute('aria-label'),'video edit dialog name').toBe('视频编辑');const expectedField=e.entry==='extend'?/^描述视频后续画面发展/:/^描述你想要对视频做的修改/;expect.soft(await root.getByPlaceholder(expectedField).count(),'menu entry selects requested initial tab').toBe(1);const frame=await panel.boundingBox();expect.soft(!!frame&&frame.x>=0&&frame.y>=0&&frame.x+frame.width<=e.width&&frame.y+frame.height<=e.height,'bounded mobile panel').toBe(true);await djCapture(s,e,'opened');const close=root.locator('button').first();
 if(e.escape){await close.focus();expect(await close.evaluate(el=>document.activeElement===el),'focus inside edit panel').toBe(true);await s.page.keyboard.press('Escape');await root.waitFor({state:'detached'});console.log('DJ_ESCAPE_COMPLETE',JSON.stringify(e));}
 else{const controls=root.locator('button');for(let i=0;i<await controls.count();i++)await djAudit(controls.nth(i));const play=root.locator('button').filter({has:s.page.locator('svg.lucide-play,svg.lucide-pause')}).last(),mute=root.locator('button').filter({has:s.page.locator('svg.lucide-volume2,svg.lucide-volume-x')}).last(),reset=root.locator('button').filter({has:s.page.locator('svg.lucide-rotate-ccw')}).last();await djTap(s,play);await expect.poll(async()=>(await djMedia(video)).time,{timeout:1500,message:'edit-preview native playback advances'}).toBeGreaterThan(.05);await djTap(s,play);await expect.poll(async()=>(await djMedia(video)).paused,{timeout:1500}).toBe(true);await djTap(s,mute);expect((await djMedia(video)).muted).toBe(true);await djTap(s,mute);expect((await djMedia(video)).muted).toBe(false);await djTap(s,reset);await expect.poll(async()=>(await djMedia(video)).time,{timeout:1500}).toBeLessThan(.01);
 const editTab=root.getByRole('button',{name:'语言编辑',exact:true}),extendTab=root.getByRole('button',{name:'视频延长',exact:true});await djTap(s,editTab);expect.soft(await editTab.getAttribute('aria-pressed'),'edit tab selected state').toBe('true');expect.soft(await root.getByLabel('编辑描述',{exact:true}).count(),'edit field associated label').toBe(1);const edit=root.getByPlaceholder(/^描述你想要对视频做的修改/),apply=root.getByRole('button',{name:'应用编辑',exact:true});expect(await apply.isDisabled(),'empty edit cannot submit').toBe(true);await edit.fill('   ');expect(await apply.isDisabled(),'whitespace edit cannot submit').toBe(true);await edit.fill('DJ synthetic UI draft; do not submit');await settle(s.page);expect(await apply.isEnabled(),'nonempty edit is operable without submitting').toBe(true);await djAudit(apply);await djTap(s,extendTab);expect.soft(await extendTab.getAttribute('aria-pressed'),'extend tab selected state').toBe('true');expect.soft(await root.getByLabel('延续描述（可选）',{exact:true}).count(),'extend field associated label').toBe(1);const extend=root.getByPlaceholder(/^描述视频后续画面发展/);await extend.fill('DJ synthetic continuation; do not submit');const five=root.getByRole('button',{name:'+5秒',exact:true}),ten=root.getByRole('button',{name:'+10秒',exact:true});await djTap(s,ten);expect.soft(await ten.getAttribute('aria-pressed'),'ten second selection').toBe('true');expect.soft(await five.getAttribute('aria-pressed'),'five second unselected').toBe('false');const backgrounds=await Promise.all([five,ten].map(b=>b.evaluate(el=>getComputedStyle(el).backgroundColor)));expect.soft(backgrounds[0],'selected duration is visibly distinct').not.toBe(backgrounds[1]);await djAudit(five);await djAudit(ten);await djAudit(root.getByRole('button',{name:'延长视频',exact:true}));await djTap(s,editTab);expect(await edit.inputValue(),'edit draft survives tab roundtrip').toBe('DJ synthetic UI draft; do not submit');await djTap(s,extendTab);expect(await extend.inputValue(),'extend draft survives tab roundtrip').toBe('DJ synthetic continuation; do not submit');expect.soft(await ten.getAttribute('aria-pressed'),'duration selection survives tab roundtrip').toBe('true');await djCapture(s,e,'forms');console.log('DJ_OPERATIONS_BODY',JSON.stringify({...e,initial,backgrounds,bodyReachedNotGate:true,actualNativePreviewPlayback:true,noSubmitButtonClicked:true,publicLocatorPreparationNotPhoneOuterScrollProof:true}));await djTap(s,close);await root.waitFor({state:'detached'});}
 const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('DJ_COMPLETE',JSON.stringify({...e,sourceAndViewUnchanged:true,noGenerationOrProviderPost:true}));}finally{await djCapture(s,e,'end-or-failure');}});},25000);
