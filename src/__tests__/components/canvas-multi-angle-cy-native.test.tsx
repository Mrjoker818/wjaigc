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
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;sphereOnly?:boolean;desktopPanelSource?:boolean}
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
import {MultiAngleSpherePreview} from '@/components/canvas/MultiAngleSpherePreview';
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
function Entry({theme,admin,catalogLoading,sphereOnly,desktopPanelSource}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean;sphereOnly:boolean;desktopPanelSource?:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>(desktopPanelSource
   ? [{id:'desktop-angle-source',url:png,x:515,y:501,width:240,height:180,name:'多角度验收源图',prompt:'多角度验收源图'}]
   : [{id:'br-A',url:png,x:100,y:160,width:56,height:56,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:270,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={false} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/>{sphereOnly&&<div id="cy-sphere-fixture" style={{position:'fixed',left:16,top:16,width:260,height:196,zIndex:100}}><MultiAngleSpherePreview imageUrl={png} rotation={0} tilt={0} zoom={1} isMonochrome={theme==='mono'}/></div>}</>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean;sphereOnly?:boolean;desktopPanelSource?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true} sphereOnly={options.sphereOnly===true} desktopPanelSource={options.desktopPanelSource===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
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









async function cyReveal(s:Session,control:Locator):Promise<void>{for(let i=0;i<12;i++){const state=await control.evaluate(el=>{const r=el.getBoundingClientRect();for(let p=el.parentElement;p;p=p.parentElement){const style=getComputedStyle(p);if(['auto','scroll'].includes(style.overflowY)&&p.scrollHeight>p.clientHeight){const b=p.getBoundingClientRect();return {rect:{top:r.top,bottom:r.bottom},scroll:{x:b.right-8,top:Math.max(4,b.top+4),bottom:Math.min(innerHeight-4,b.bottom-4)}};}}return {rect:{top:r.top,bottom:r.bottom},scroll:null};});if(!state.scroll||state.rect.top>=state.scroll.top&&state.rect.bottom<=state.scroll.bottom)return;const b=state.scroll,dy=state.rect.top<b.top?Math.min(110,b.bottom-b.top-24):-Math.min(110,b.bottom-b.top-24),y=dy<0?b.bottom-16:b.top+16,c=await s.context.newCDPSession(s.page);try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x,y,id:1}]});try{for(const t of [.25,.5,.75,1]){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x,y:y+dy*t,id:1}]});await settle(s.page);}}finally{await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}}finally{await c.detach();}}throw Error('CL_NATIVE_SCROLL_BOUND');}


async function cyDrag(s:Session,x:number,y:number,dx:number,dy:number,cancel=false):Promise<void>{const hit=await s.page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y),r=el?.getBoundingClientRect();return {tag:el?.tagName,classes:el?.getAttribute('class'),width:r?.width,height:r?.height,panel:el?.closest('[data-toolbar],[data-popup],[data-floating-panel]')?.getAttribute('data-toolbar')};},{x,y});console.log('CY_NATIVE_START',JSON.stringify({x,y,dx,dy,cancel,hit}));const c=await s.context.newCDPSession(s.page);let active=false;try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,force:1}]});active=true;for(const t of [.25,.5,.75,1]){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*t,y:y+dy*t,id:1,force:1}]});await settle(s.page);}await c.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});active=false;}finally{try{if(active)await c.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await c.detach();}}await settle(s.page);}

interface CYEntry {theme:Theme;width:number;height:number}
const cyMatrix:CYEntry[]=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
const cyPreviewTitle='按住左键拖动：横向调整旋转，纵向调整倾斜';
async function cyCapture(s:Session,e:CYEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-multi-angle-cy-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+label+'.png');await s.page.screenshot({path:file});console.log('CY_CAPTURE',JSON.stringify({path:file,label,noGenerationOrDeviceProof:true}));}
async function cyTap(s:Session,c:Locator):Promise<void>{await cyReveal(s,c);await c.tap();await settle(s.page);}
async function cyTexture(canvas:Locator):Promise<void>{await expect.poll(async()=>canvas.evaluate(el=>{const p=(el as HTMLCanvasElement).getContext('2d')?.getImageData(100,98,1,1).data;if(!p)return false;return p[0]>p[1]+20&&p[1]>p[2]+10&&p[3]===255;}),{timeout:1500,message:'actual cold image is painted without changing parameters'}).toBe(true);console.log('CY_COLD_TEXTURE',JSON.stringify(await canvas.evaluate(el=>Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(100,98,1,1).data))));}
async function cyAudit(s:Session,panel:Locator):Promise<void>{const controls=panel.locator('button,input');for(let i=0;i<await controls.count();i++){const c=controls.nth(i);await cyReveal(s,c);const v=await c.evaluate(el=>{const r=el.getBoundingClientRect(),faults:string[]=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.left<r.left-.5||b.right>r.right+.5||b.top<r.top-.5||b.bottom>r.bottom+.5)faults.push('text-clipped');}return {name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),faults};});console.log('CY_CONTROL',JSON.stringify(v));expect.soft(v.width,v.name+' touch width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' touch height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' native visible hit').toBe(true);expect.soft(v.name,'accessible purpose').not.toBe('');expect.soft(v.faults,v.name+' readable').toEqual([]);}}
for(const e of cyMatrix){
 it('CY '+e.theme+' '+e.width+'x'+e.height+' isolated real sphere cold image paints',async()=>{await withSession(e.theme,e.width,e.height,{touch:true,sphereOnly:true},async s=>{try{await cyTexture(s.page.locator('#cy-sphere-fixture canvas'));console.log('CY_LEAF_COMPLETE',JSON.stringify({...e,realLeafAlongsideOriginalParent:true,noParameterChanges:true}));}finally{await cyCapture(s,e,'leaf-end-or-failure');}});},25000);
 it('CY '+e.theme+' '+e.width+'x'+e.height+' parent controls native preview touch cancel mouse and no submit',async()=>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);try{await s.page.locator('[data-canvas-image-id="br-A"]').tap({position:{x:28,y:38}});await s.page.locator('[data-mobile-image-actions]').getByRole('button',{name:'更多',exact:true}).tap();await s.page.getByRole('dialog',{name:'图片工具',exact:true}).getByRole('button',{name:'多角度',exact:true}).tap();const preview=s.page.getByTitle(cyPreviewTitle,{exact:true}),panel=preview.locator('..');await preview.waitFor({state:'visible'});await cyCapture(s,e,'parent-opened');await cyAudit(s,panel);const ranges=panel.locator('input[type="range"]');expect(await ranges.count()).toBe(2);for(const label of ['主体','摄像头']){const b=panel.getByRole('button',{name:label,exact:true});await cyTap(s,b);expect.soft(await b.getAttribute('aria-pressed'),label+' selection visible to assistive technology').toBe('true');if(label==='摄像头')await cyTexture(preview.locator('canvas'));}for(const label of ['特写','广角','标准']){const b=panel.getByRole('button',{name:label,exact:true});await cyTap(s,b);expect.soft(await b.getAttribute('aria-pressed'),label+' selection exposed').toBe('true');}for(let i=0;i<2;i++){await cyReveal(s,ranges.nth(i));const r=await ranges.nth(i).boundingBox();if(!r)throw Error('CY_REAL_RANGE_BOUNDS');await ranges.nth(i).tap({position:{x:r.width*.75,y:r.height/2}});expect(Number(await ranges.nth(i).inputValue())).toBeGreaterThan(0);await cyDrag(s,r.x+r.width*.75,r.y+r.height/2,-r.width*.5,0);expect(Number(await ranges.nth(i).inputValue())).toBeLessThan(0);}await cyTap(s,panel.getByTitle('重置',{exact:true}));expect(await ranges.nth(0).inputValue()).toBe('0');expect(await ranges.nth(1).inputValue()).toBe('0');expect(await panel.getByRole('button',{name:'标准',exact:true}).getAttribute('aria-pressed')).toBe('true');await cyReveal(s,preview);const r=await preview.boundingBox();if(!r)throw Error('CY_REAL_PREVIEW_BOUNDS');const p={x:r.x+r.width/2,y:r.y+r.height/2};expect(await preview.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),p)).toBe(true);await cyDrag(s,p.x,p.y,24,16);expect(await ranges.nth(0).inputValue(),'native touch changes rotation').toBe('13');expect(await ranges.nth(1).inputValue(),'native touch changes tilt').toBe('-9');await cyDrag(s,p.x,p.y,-16,16,true);expect(await ranges.nth(0).inputValue(),'cancel restores prior rotation').toBe('13');expect(await ranges.nth(1).inputValue(),'cancel restores prior tilt').toBe('-9');await cyTap(s,panel.getByTitle('重置',{exact:true}));await cyReveal(s,preview);const m=await preview.boundingBox();if(!m)throw Error('CY_MOUSE_PREVIEW');await s.page.mouse.move(m.x+m.width/2,m.y+m.height/2);await s.page.mouse.down();await s.page.mouse.move(m.x+m.width/2+24,m.y+m.height/2+16,{steps:4});await s.page.mouse.up();await settle(s.page);expect(await ranges.nth(0).inputValue(),'original mouse drag rotation retained').toBe('13');expect(await ranges.nth(1).inputValue(),'original mouse drag tilt retained').toBe('-9');await cyCapture(s,e,'parent-inputs');await cyTap(s,panel.getByRole('button',{name:'取消',exact:true}));await preview.waitFor({state:'detached'});const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('CY_PARENT_COMPLETE',JSON.stringify({...e,sourceAndViewUnchanged:true,noSubmit:true,coldParentTexture:true,nativeRangesTouchCancelMouse:true}));}finally{await cyCapture(s,e,'parent-end-or-failure');}});},25000);
}

it('keeps the desktop multi-angle panel inside the viewport and scrolls on short desktop', async () => {
  await withSession('gold', 1440, 900, { desktopPanelSource:true }, async ({page}) => {
    const source=page.locator('[data-canvas-image-id="desktop-angle-source"]');
    await source.click();
    const action=page.getByRole('button',{name:'多角度',exact:true}).filter({visible:true}).first();
    if (!await action.isVisible()) {
      await page.getByRole('button',{name:'展开更多工具',exact:true}).filter({visible:true}).first().click();
    }
    await action.click();
    const panel=page.locator('[data-popup="multi-angle"]');
    const camera=panel.getByRole('button',{name:'摄像头',exact:true});
    await panel.waitFor();
    const panelY=(await panel.boundingBox())!.y;
    const cameraY=(await camera.boundingBox())!.y;
    expect(panelY, 'multi-angle panel top (previously -119.5 px)').toBeGreaterThanOrEqual(0);
    expect(cameraY, 'camera control top (previously -70.5 px)').toBeGreaterThanOrEqual(0);

    // The workspace project menu uses z-index 70 and can wrap over the tool.
    await page.evaluate(() => {
      const header=document.createElement('div');
      header.setAttribute('data-fixture-project-menu','');
      header.style.cssText='position:fixed;left:56px;right:0;top:12px;height:150px;z-index:70';
      document.body.append(header);
    });
    const cameraReceivesPointer=()=>camera.evaluate(button=>{
      const box=button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    });
    expect(await cameraReceivesPointer(), 'the accessible mode control is above the workspace project menu').toBe(true);
    await camera.click();
    expect(await camera.getAttribute('aria-pressed')).toBe('true');
    expect(await source.getAttribute('data-canvas-selected')).toBe('true');

    const preview=panel.getByTitle(cyPreviewTitle,{exact:true});
    await cyTexture(preview.locator('canvas'));
    const previewBounds=(await preview.boundingBox())!;
    const centerX=previewBounds.x+previewBounds.width/2;
    const centerY=previewBounds.y+previewBounds.height/2;
    await page.mouse.move(centerX,centerY);
    await page.mouse.down();
    await page.mouse.move(centerX+40,centerY-20,{steps:8});
    await page.mouse.up();
    const rotation=panel.getByRole('slider',{name:'旋转',exact:true});
    const tilt=panel.getByRole('slider',{name:'垂直视角',exact:true});
    await expect.poll(async () => Number(await rotation.inputValue())).toBe(22);
    await expect.poll(async () => Number(await tilt.inputValue())).toBe(11);

    await page.setViewportSize({width:800,height:320});
    await settle(page);
    const bounds=(await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(800);
    expect(bounds.y+bounds.height).toBeLessThanOrEqual(320);
    expect(await camera.getAttribute('aria-pressed')).toBe('true');
    expect(await rotation.inputValue()).toBe('22');

    const viewState=page.locator('[data-canvas-surface]');
    const initialTransform=await viewState.evaluate(node=>node.style.transform);
    const scrollable=panel.getByRole('region',{name:'多角度',exact:true});
    const cancel=panel.getByRole('button',{name:'取消',exact:true});
    expect((await cancel.boundingBox())!.y).toBeGreaterThan(bounds.y+bounds.height);
    await page.mouse.move(bounds.x+bounds.width-24,bounds.y+bounds.height/2);
    await page.mouse.wheel(0,700);
    await expect.poll(async () => {
      const button=(await cancel.boundingBox())!;
      return button.y>=bounds.y && button.y+button.height<=bounds.y+bounds.height;
    }).toBe(true);
    expect(await viewState.evaluate(node=>node.style.transform)).toBe(initialTransform);

    await scrollable.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => scrollable.evaluate(node=>node.scrollTop)).toBe(0);

    await page.setViewportSize({width:767,height:320});
    await settle(page);
    const mobileBounds=(await panel.boundingBox())!;
    expect(mobileBounds.x).toBeGreaterThanOrEqual(0);
    expect(mobileBounds.y).toBeGreaterThanOrEqual(0);
    expect(mobileBounds.x+mobileBounds.width).toBeLessThanOrEqual(767);
    expect(mobileBounds.y+mobileBounds.height).toBeLessThanOrEqual(320);
    expect(await cameraReceivesPointer(), 'the project menu does not cover the narrow-screen control').toBe(true);
    expect(await rotation.inputValue()).toBe('22');
    await cancel.click();
    await panel.waitFor({state:'detached'});
    expect(await source.getAttribute('data-canvas-selected')).toBe('true');
  });
}, 25000);
