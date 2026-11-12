// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { CANVAS_FRAME_SOURCE, createCanvasFrameServerFixture } from '../helpers/canvas-frame-server-fixture';

const owned = vi.hoisted(() => ({ root: '' }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ userId: 'omp-mobile-user', userRole: 'user' }),
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => owned.root }));
type FrameServer = Awaited<ReturnType<typeof createCanvasFrameServerFixture>>;
let frameServer: FrameServer | undefined;
let post: typeof import('@/app/api/video/tools/route').POST;
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
type NativePhase = 'setup' | 'case' | 'unmount' | 'drain' | 'context-close';
type NativeEvent = 'started' | 'routed' | 'response' | 'terminal' | 'routeSettled';
type NativeLifecycle = Partial<Record<NativeEvent, { sequence: number; phase: NativePhase }>>;
interface Session {frAudits:FRActivity[];frResults:Array<Awaited<ReturnType<FrameServer['extract']>>>;context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number;nativePhase:NativePhase;nativeLifecycle:WeakMap<Request,NativeLifecycle>;verifiedFrameUrl?:string}
const ORIGIN='https://canvas-shell-mobile.invalid';
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InfiniteCanvas,type CanvasImage} from '@/components/infinite-canvas';
import {TreeHistoryManager} from '@/lib/canvas-tree-history';
import {taskEventsClient} from '@/lib/task-events-client';
import {OperationAuditClient} from '@/components/operation-audit-client';
import {Toaster} from '@/components/ui/sonner';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('CANVAS_UI_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const manager=new TreeHistoryManager();
const state={frReceipts:[] as Array<{urls:string[];metadata:{modelName:string;apiProvider:string}}>,mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],groups:[] as Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>,actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
const bxDescriptor={providerId:'bx-provider',modelId:'bx-image',kind:'image' as const,sourceType:'image' as const,protocol:'openai',executionMode:'sync' as const,allowedRatios:['1:1','3:2'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:2,supportsVision:false,supportsReferenceImages:true,maxReferenceImages:14,supportsMask:false,allowedDurationsSeconds:[],maxDurationSeconds:0,supportedOperations:['image-to-image','multi-reference'] as Array<'image-to-image'|'multi-reference'>,outputKinds:['image'],capabilitySources:{allowedRatios:'admin' as const,allowedSizes:'admin' as const,qualityOptions:'admin' as const,supportsReferenceImages:'admin' as const,maxReferenceImages:'admin' as const}};
const bxUnsupported={...bxDescriptor,modelId:'bx-no-reference',supportsReferenceImages:false,maxReferenceImages:0};
const bySecond={...bxDescriptor,providerId:'by-provider-b',maxReferenceImages:2,allowedRatios:['1:1','16:9'],allowedSizes:['1536x1024'],qualityOptions:['hd'],maxOutputs:1};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,mediaType:'video' as const,videoUrl:"${CANVAS_FRAME_SOURCE}",videoDuration:1.5,x:40,y:120,width:240,height:135,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:270,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><Toaster position="top-center" toastOptions={{className:theme==='mono'?'bg-white border border-gray-200 text-gray-900 shadow-lg shadow-gray-200/50':'bg-[#1a1a1a] border border-[#2a2a2a] text-white shadow-lg shadow-black/30',style:{borderRadius:'12px',fontSize:'13px'}}}/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={action('unexpected-legacy-insertion')} captureVideoToolInsertion={()=>({assertCurrent:scope.assertCurrent,insert:async output=>{
   scope.assertCurrent(true);
   if(output.format!=='image/png'||output.modelName!=='frame-extract'||output.urls.length!==1||!output.urls[0].startsWith('/api/serve-upload/generated-videos/')||state.frReceipts.length!==0)throw Error('FR_EXACT_PUBLIC_MEMORY_PUBLICATION');
   state.frReceipts.push({urls:[...output.urls],metadata:{modelName:output.modelName,apiProvider:'local'}});
   state.actions.push('fr-server-frame');
   setImages(current=>[...current,{id:'fr-output',url:output.urls[0],x:44,y:456,width:160,height:90,name:'OWN extracted frame'}]);
   return 1;
 }})}
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
  frameServer = await createCanvasFrameServerFixture();
  owned.root = frameServer.root;
  ({ POST: post } = await import('@/app/api/video/tools/route'));
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  const errors: string[] = [];
  for (const s of live) { try { await dispose(s); } catch (error) { errors.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { errors.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; await frameServer?.close(); }
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
    const s: Session = { frAudits:[],frResults:[],context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),releaseRecovery,recoveryCalls:0,
      nativePhase: 'setup', nativeLifecycle: new WeakMap() }; value = s; live.add(s);
    let nativeSequence = 0;
    const recordNativeEvent = (request: Request, event: NativeEvent): void => {
      const lifecycle = s.nativeLifecycle.get(request) ?? {};
      lifecycle[event] = { sequence: ++nativeSequence, phase: s.nativePhase };
      s.nativeLifecycle.set(request, lifecycle);
    };
    context.on('request', request => { recordNativeEvent(request, 'started'); s.pending.add(request); });
    context.on('response', response => { recordNativeEvent(response.request(), 'response'); s.responseStatus.set(response.request(),response.status());if(response.url()===ORIGIN+'/api/task-events')console.log('FD_SSE_NATIVE_RESPONSE',JSON.stringify({url:response.url(),status:response.status(),contentType:response.headers()['content-type']??null})); });
    context.on('requestfinished', request => { recordNativeEvent(request, 'terminal'); s.pending.delete(request); s.completed.add(request); for (const notify of s.nativeWaiters) notify(); });
    context.on('requestfailed', request => { recordNativeEvent(request, 'terminal'); s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('FR_UNEXPECTED_NATIVE_DIALOG'); void dialog.dismiss(); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('CANVAS_UI_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const request = route.request();
      recordNativeEvent(request, 'routed');
      const operation = (async (): Promise<void> => {
        const url = new URL(request.url()), headers = request.headers();
        if (url.origin === ORIGIN && url.search === '' && request.method() === 'POST'
          && (url.pathname === '/api/activity' || url.pathname === '/api/video/tools')) {
          if (url.username || url.password || headers.authorization || headers.cookie || headers['x-api-key']
            || headers['api-key'] || headers['idempotency-key'] || headers['content-type'] !== 'application/json'
            || request.isNavigationRequest()) throw Error('FR_EXACT_OFFLINE_POST_BOUNDARY');
          const count = (s.counts.get(url.pathname) ?? 0) + 1;
          s.counts.set(url.pathname, count);
          const raw = request.postData();
          if (count !== 1 || raw === null || Buffer.byteLength(raw) > 512) throw Error('FR_EXACT_OFFLINE_POST_COUNT');
          if (url.pathname === '/api/video/tools') {
            if (!frameServer) throw Error('FR_OWNED_SERVER_FIXTURE_REQUIRED');
            const result = await frameServer.extract(post, ORIGIN, raw);
            s.frResults.push(result);
            await route.fulfill({ status: result.status, json: result.body });
          } else {
            const result = s.frResults[0], p: FRActivity = JSON.parse(raw);
            if (!result || Object.keys(p).sort().join(',') !== 'action,durationMs,method,path,status'
              || p.action !== 'post_api_request' || p.method !== 'POST' || p.path !== '/api/video/tools'
              || p.status !== result.status || !Number.isSafeInteger(p.durationMs) || p.durationMs < 0)
              throw Error('FR_EXACT_EXTRACT_AUDIT_SCHEMA');
            s.frAudits.push(p);
            await route.fulfill({ json: { success: true } });
          }
          return;
        }
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        const frame = s.frResults[0]?.frame;
        const ownedFrameImage = frame?.url === key && request.resourceType() === 'image' && !request.isNavigationRequest();
        const limit = ['/api/session','/api/auth/me','/api/task-events'].includes(key) ? 6
          : (key === CANVAS_FRAME_SOURCE || HELP_FILES.some(file => key === '/api/help-image?file=' + file)) ? 3
          : ownedFrameImage ? 2 : 1;
        if (count > limit) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:200,contentType:'text/event-stream',body:': heartbeat\n\n' });return; }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === CANVAS_FRAME_SOURCE && frameServer) {
          await route.fulfill({ contentType: 'video/mp4', body: frameServer.clip }); return;
        }
        if (frame && key === frame.url) {
          await route.fulfill({ contentType: 'image/png', body: frame.buffer }); return;
        }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(request); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { recordNativeEvent(request, 'routeSettled'); s.handlers.delete(operation); }
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
  s.nativePhase = 'unmount';
  try {
    if (s.mounted) await bounded('unmount', () => s.page.evaluate(() => (window as unknown as FixtureWindow).canvasUi.unmount()));
    cleanupProbe?.(); // Used only by the cleanup-fault selftest, after real unmount.
  } catch (error) { failures.push(error); }
  s.nativePhase = 'drain';
  try { await bounded('routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  try { await nativeRequestsFinished(s); await bounded('final routes', () => Promise.all([...s.handlers])); } catch (error) { failures.push(String(error)); }
  const pendingBeforeClose = [...s.pending];
  const routesBeforeClose = s.handlers.size;
  const unresolvedBeforeClose = pendingBeforeClose.length !== 0 || routesBeforeClose !== 0;
  s.nativePhase = 'context-close';
  try { await s.context.close(); contexts.delete(s.context); live.delete(s); } catch (error) { failures.push(String(error)); }
  // Cleanup/lifecycle/allowlist failures can never share the expected-refusal
  // prefix. A boundary selftest must not succeed merely because close failed.
  const invalid=(code:string):never=>{if(failures.length)throw new AggregateError([Error(code),...failures],'CANVAS_UI_FIXTURE_VALIDATION_AND_CLEANUP');throw Error(code);};
  const allowed=['/api/activity','/api/video/tools',CANVAS_FRAME_SOURCE,...s.frResults.flatMap(result => result.frame ? [result.frame.url] : []),'/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
  const keys=[...s.counts.keys()];
  if(s.options.requireMissing || s.counts.get('/')!==1 || keys.some(k=>!allowed.includes(k)&&!(expectedRefusal==='http'&&k==='/unexpected'))){
    console.log('CANVAS_UI_FIXTURE_REQUEST_DIAGNOSTIC',JSON.stringify({counts:[...s.counts],errors:s.errors}));
    invalid('CANVAS_UI_FIXTURE_REQUEST_VALIDATION');
  }
  const completed=[...s.completed].map(r=>r.url());
  const expectedCompleted=[...s.counts].filter(([k])=>k!=='/unexpected').flatMap(([k,n])=>Array.from({length:n},()=>ORIGIN+k));
  const failed=[...s.failed];
  const validFailures=expectedRefusal==='http'?failed.length===1&&failed[0].url()===ORIGIN+'/unexpected'&&s.refused.has(failed[0]):failed.length===0;
  const frame = s.frResults[0]?.frame;
  const frameReads = frame ? (s.counts.get(frame.url) ?? 0) : 0;
  const completedFrameReads = frame ? [...s.completed].filter(request => request.url() === ORIGIN + frame.url) : [];
  const frameWitnessed = frame !== undefined && s.verifiedFrameUrl === frame.url;
  const validRepeatedFrameRead = frameReads <= 1 || (frameReads === 2 && frameWitnessed && completedFrameReads.length === 2
    && completedFrameReads.every(request => request.method() === 'GET' && request.resourceType() === 'image'
      && s.responseStatus.get(request) === 200));
  if(unresolvedBeforeClose||s.pending.size||!validFailures||!validRepeatedFrameRead||JSON.stringify(completed.sort())!==JSON.stringify(expectedCompleted.sort())){
    const safePath = (url: string): string => {
      if (!url.startsWith(ORIGIN + '/')) return '[other-origin]';
      const key = url.slice(ORIGIN.length);
      if (key === frame?.url) return '/api/serve-upload/generated-videos/[frame].png';
      return allowed.includes(key) ? key : '[other-route]';
    };
    const details = (request: Request) => {
      const error = request.failure()?.errorText;
      return {
        method: request.method() === 'GET' || request.method() === 'POST' ? request.method() : 'OTHER',
        path: safePath(request.url()), resourceType: request.resourceType(), status: s.responseStatus.get(request) ?? null,
        error: error && /^net::ERR_[A-Z_]+(?:\.Inspector)?$/.test(error) ? error : error ? '[other-error]' : null,
        refused: s.refused.has(request), lifecycle: s.nativeLifecycle.get(request),
      };
    };
    console.log('CANVAS_UI_NATIVE_REQUEST_FAILURE_DIAGNOSTIC', JSON.stringify({
      unresolvedBeforeClose, routesBeforeClose, pendingBeforeClose: pendingBeforeClose.length, pendingAfterClose: s.pending.size,
      pending: [...new Set([...pendingBeforeClose, ...s.pending])].slice(0, 6).map(details),
      completedCount: completed.length, expectedCompletedCount: expectedCompleted.length,
      completed: completed.slice(0, 12).map(safePath), expectedCompleted: expectedCompleted.slice(0, 12).map(safePath),
      failedCount: failed.length, failed: failed.slice(0, 6).map(details),
      frame: { reads: frameReads, witnessed: frameWitnessed, completed: completedFrameReads.slice(0, 2).map(details) },
    }));
    invalid('CANVAS_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
  }
  if (failures.length) throw Error('CANVAS_UI_FIXTURE_CLEANUP_FAILURE: ' + failures.join('; '));
  if (expectedRefusal) {
    const expected = expectedRefusal === 'http' ? 'Error: CANVAS_UI_FIXTURE_UNKNOWN_HTTP /unexpected' : 'CANVAS_UI_FIXTURE_UNKNOWN_WS';
    if (s.errors.length !== 1 || s.errors[0] !== expected) throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_FAILURES: ' + s.errors.join('; '));
  }
  if (s.errors.length) throw Error('CANVAS_UI_FIXTURE_INFRASTRUCTURE: ' + s.errors.join('; '));
}

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);s.nativePhase='case';let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}













interface FRActivity {action:'post_api_request';method:'POST';path:'/api/video/tools';status:number;durationMs:number}
interface FRReceipt {urls:string[];metadata:{modelName:string;apiProvider:string}}
interface FRWindow extends Window {canvasUi:{state:FixtureWindow['canvasUi']['state']&{frReceipts:FRReceipt[]}}}
interface FUViewport {width:number;height:number}
interface FUValue {label:string;literal:string|null;menu:'提取帧'|'提取封面';message:string;color:'red'|'blue'|null}
const fuViewports:FUViewport[]=[{width:375,height:812},{width:320,height:700}];
const fuValues:FUValue[]=[{label:'zero',literal:'0',menu:'提取帧',message:'已提取帧 @ 0s',color:'red'},{label:'quarter',literal:'0.25',menu:'提取帧',message:'已提取帧 @ 0.25s',color:'red'},{label:'three-quarter',literal:'0.75',menu:'提取帧',message:'已提取帧 @ 0.75s',color:'blue'},{label:'duration',literal:'1.5',menu:'提取帧',message:'指定时间无效或超出视频时长',color:null},{label:'beyond-duration',literal:'2',menu:'提取帧',message:'指定时间无效或超出视频时长',color:null},{label:'cover',literal:null,menu:'提取封面',message:'已提取视频封面',color:'red'}];
async function fuState(s:Session):Promise<FRWindow['canvasUi']['state']>{return s.page.evaluate(()=>(window as unknown as FRWindow).canvasUi.state);}
async function fuMenu(s:Session):Promise<Locator>{const point={x:128,y:198};expect(await s.page.evaluate(p=>Boolean(document.elementFromPoint(p.x,p.y)?.closest('[data-canvas-image-id="br-A"]')),point)).toBe(true);const c=await s.context.newCDPSession(s.page);try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,force:1}]});try{await s.page.locator('[data-popup="context-menu"]').waitFor({state:'visible'});}finally{await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}}finally{await c.detach();}await settle(s.page);const menu=s.page.locator('[data-popup="context-menu"]');await menu.waitFor({state:'visible'});return menu;}
interface FURect {x:number;y:number;width:number;height:number;right:number;bottom:number}
interface FUToast {message:string;toast:FURect;title:FURect;close:FURect;titleScrollWidth:number;titleClientWidth:number;scrollWidth:number;clientWidth:number;coarse:boolean}
async function fuToast(toast:Locator):Promise<FUToast>{return toast.evaluate(el=>{const title=el.querySelector('[data-title]'),close=el.querySelector('[data-close-button]');if(!(el instanceof HTMLElement)||!(title instanceof HTMLElement)||!(close instanceof HTMLElement))throw Error('FU_REAL_SUCCESS_TOAST_ELEMENTS');const rect=(node:Element):FURect=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{message:title.textContent??'',toast:rect(el),title:rect(title),close:rect(close),titleScrollWidth:title.scrollWidth,titleClientWidth:title.clientWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,coarse:matchMedia('(pointer: coarse)').matches};});}
for(const theme of ['gold','mono'] as const)for(const vp of fuViewports)for(const value of fuValues)it(`FU ${theme} ${vp.width}x${vp.height} ${value.label} actual position feedback`,async()=>{
 await withSession(theme,vp.width,vp.height,{touch:true},async s=>{
  const before=await fuState(s);
  expect(before.images).toHaveLength(3);
  expect(before.frReceipts).toEqual([]);
  const menu=await fuMenu(s);
  await menu.getByRole('button',{name:value.menu,exact:true}).tap();
  await menu.waitFor({state:'detached'});
  const form=s.page.getByRole('dialog',{name:'视频抽帧',exact:true});
  if(value.literal!==null){
    const time=form.getByRole('textbox',{name:'提取时间点（秒）',exact:true});
    await time.fill(value.literal);
    await expect.poll(()=>form.locator('video').evaluate(el=>(el as HTMLVideoElement).duration)).toBe(1.5);
    await form.getByRole('button',{name:'开始抽帧',exact:true}).tap();
  }
  const type=value.color===null?'error':'success';
  const toast=s.page.locator('[data-sonner-toast][data-type="'+type+'"]');
  await toast.waitFor({state:'visible'});
  expect(await toast.count()).toBe(1);
  await expect.poll(()=>toast.getAttribute('data-mounted')).toBe('true');
  await nativeRequestsFinished(s);
  await settle(s.page);
  const observed=await fuToast(toast),after=await fuState(s);
  expect.soft(observed.message,'feedback matches the confirmed timestamp or rejection').toBe(value.message);
  expect.soft(observed.coarse).toBe(true);expect.soft(observed.toast.x).toBeGreaterThanOrEqual(8);expect.soft(observed.toast.y).toBeGreaterThanOrEqual(0);expect.soft(observed.toast.right).toBeLessThanOrEqual(vp.width-8);expect.soft(observed.toast.bottom).toBeLessThanOrEqual(vp.height);expect.soft(observed.scrollWidth).toBeLessThanOrEqual(observed.clientWidth+1);expect.soft(observed.titleScrollWidth).toBeLessThanOrEqual(observed.titleClientWidth+1);expect.soft(observed.title.x).toBeGreaterThanOrEqual(observed.toast.x);expect.soft(observed.title.right).toBeLessThanOrEqual(observed.toast.right);expect.soft(observed.title.right<=observed.close.x||observed.title.x>=observed.close.right||observed.title.bottom<=observed.close.y||observed.title.y>=observed.close.bottom,'success text is not under close control').toBe(true);expect.soft(observed.close.width).toBeGreaterThanOrEqual(44);expect.soft(observed.close.height).toBeGreaterThanOrEqual(44);
  expect(s.frResults).toHaveLength(1);
  expect(s.frAudits).toHaveLength(1);
  const [result]=s.frResults;
  expect(result.timestamp).toBe(value.literal===null?0:Number(value.literal));
  expect(after.groups).toEqual(before.groups);
  expect(after.view).toEqual(before.view);
  expect(after.images.slice(0,3)).toEqual(before.images);
  if(value.color===null){
    expect(result.status).toBe(400);
    expect(result.frame).toBeUndefined();
    expect(after.frReceipts).toEqual([]);
    expect(after.images).toEqual(before.images);
    expect(after.actions).toEqual(before.actions);
    expect(await form.isVisible()).toBe(true);
  }else{
    expect(result.status).toBe(200);
    const frame=result.frame!;
    expect(after.frReceipts).toEqual([{urls:[frame.url],metadata:{modelName:'frame-extract',apiProvider:'local'}}]);
    expect(after.images).toHaveLength(4);
    expect(after.actions).toEqual([...before.actions,'fr-server-frame']);
    expect(await s.page.locator('[data-sonner-toast][data-type="error"]').count()).toBe(0);
    const [r,g,b]=frame.center;
    expect(g).toBeLessThan(30);
    expect(value.color==='red'?r:b).toBeGreaterThan(200);
    expect(value.color==='red'?b:r).toBeLessThan(30);
    const output=s.page.locator('[data-canvas-image-id="fr-output"] img');
    await expect.poll(()=>output.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBe(160);
    expect(await output.evaluate(el=>(el as HTMLImageElement).naturalHeight)).toBe(90);
    expect(await output.getAttribute('src')).toBe(ORIGIN+frame.url);
    expect(await output.isVisible()).toBe(true);
    s.verifiedFrameUrl = frame.url;
  }
  const dir=path.resolve('output/playwright/frame-label-fu-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,`${theme}-${vp.width}x${vp.height}-${value.label}.png`);await s.page.screenshot({path:file});console.log('FU_CAPTURE',JSON.stringify({path:file,bodyNotGate:true}));console.log('FU_COMPLETE',JSON.stringify({theme,width:vp.width,height:vp.height,label:value.label,onlyTimePositionNotExactDecodedFrameIndex:true,bodyNotGate:true}));
 });
},25000);
