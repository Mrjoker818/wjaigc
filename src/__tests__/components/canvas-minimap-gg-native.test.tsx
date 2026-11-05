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
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;collapsed?:boolean;seedImage?:boolean}
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
const pwSource:CanvasImage={id:'pw-layer-source',name:'PW 原始图层',url:png,x:40,y:40,width:64,height:64};
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],groups:[] as Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>,actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
const bxDescriptor={providerId:'bx-provider',modelId:'bx-image',kind:'image' as const,sourceType:'image' as const,protocol:'openai',executionMode:'sync' as const,allowedRatios:['1:1','3:2'],allowedSizes:['1024x1024'],qualityOptions:['standard'],maxOutputs:2,supportsVision:false,supportsReferenceImages:true,maxReferenceImages:14,supportsMask:false,allowedDurationsSeconds:[],maxDurationSeconds:0,supportedOperations:['image-to-image','multi-reference'] as Array<'image-to-image'|'multi-reference'>,outputKinds:['image'],capabilitySources:{allowedRatios:'admin' as const,allowedSizes:'admin' as const,qualityOptions:'admin' as const,supportsReferenceImages:'admin' as const,maxReferenceImages:'admin' as const}};
const bxUnsupported={...bxDescriptor,modelId:'bx-no-reference',supportsReferenceImages:false,maxReferenceImages:0};
const bySecond={...bxDescriptor,providerId:'by-provider-b',maxReferenceImages:2,allowedRatios:['1:1','16:9'],allowedSizes:['1536x1024'],qualityOptions:['hd'],maxOutputs:1};
function Entry({theme,admin,catalogLoading,collapsed,seedImage}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean;collapsed:boolean;seedImage:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>(() => seedImage ? [{...pwSource}] : []);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed={collapsed} isAdmin={admin}
 taskModelCatalog={[bxDescriptor,bxUnsupported,bySecond]} taskModelOptions={[{id:'bx-image',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 图像',type:'image'},{id:'bx-no-reference',providerId:'bx-provider',providerName:'BX 合成供应商',name:'BX 不支持参考图',type:'image'},{id:'bx-image',providerId:'by-provider-b',providerName:'BY 合成供应商乙',name:'BY 图像乙',type:'image'}]} themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 initialGroups={groups} onGroupsChange={next=>{setGroups(next);}} versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onSendToChat={image=>{state.actions.push('chat:'+image.id);}} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/></>;
}
Object.assign(window,{canvasUi:{state,png,mount(theme:'gold'|'mono',options:{admin?:boolean;catalogLoading?:boolean;collapsed?:boolean;seedImage?:boolean}){if(state.mounts||state.disposed)throw Error('CANVAS_UI_FIXTURE_REMOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,observe,true);document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');if(options.seedImage)manager.initializeRoot([pwSource],'PW draft source');root.render(<Entry theme={theme} admin={options.admin===true} catalogLoading={options.catalogLoading===true} collapsed={options.collapsed===true} seedImage={options.seedImage===true}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','gotpointercapture','lostpointercapture','click'])document.removeEventListener(type,observe,true);}}});
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















interface GECase {theme:Theme;width:number;height:number;collapsed:boolean;available:boolean}
const geCases:GECase[]=THEMES.flatMap(theme=>[
 {theme,width:768,height:1024,collapsed:true,available:true},
 {theme,width:1040,height:720,collapsed:false,available:true},
]);
async function geTap(s:Session,el:Locator):Promise<void>{await el.scrollIntoViewIfNeeded();await el.tap();await settle(s.page);}
async function geCommand(s:Session,name:string|null):Promise<void>{
 await s.page.keyboard.press('Control+k');const palette=s.page.locator('[data-command-palette]');await palette.waitFor({state:'visible'});
 await palette.getByRole('searchbox',{name:'搜索画布命令'}).fill(name??'小地图');
 if(name){await geTap(s,palette.getByRole('button',{name:new RegExp('^'+name)}));await palette.waitFor({state:'detached'});}
 else{expect(await palette.locator('[data-command-index]').count()).toBe(0);await s.page.keyboard.press('Escape');await palette.waitFor({state:'detached'});}
}
async function geView(s:Session):Promise<{offsetX:number;offsetY:number;zoom:number}|null>{return s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view);}
async function geCapture(s:Session,e:GECase,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-minimap-gf-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,`${e.theme}-${e.width}x${e.height}-${label}.png`);await s.page.screenshot({path:file});console.log('GF_CAPTURE',JSON.stringify({path:file,label,notCloudEdgeAndroidOrActualRightSidebarAcceptance:true}));}
async function geMapBounds(s:Session,e:GECase,root:Locator,dock?:Locator):Promise<void>{
 const r=await root.boundingBox();if(!r)throw Error('GF_MAP_ROOT_BOUNDS');const occupied=e.collapsed?20:480;
 expect(r.width).toBe(192);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width,'public-prop reserve only, no real right-sidebar claim').toBeLessThanOrEqual(e.width-occupied-11);
 if(dock){const d=await dock.boundingBox();if(!d)throw Error('GF_REAL_DOCK_BOUNDS');expect(r.y+r.height,'minimap clears actual shipped dock by28px').toBeLessThanOrEqual(d.y-27);expect(d.y+d.height).toBeCloseTo(e.height,1);expect(d.width).toBeCloseTo(e.width-(e.collapsed?0:480),1);}
 else expect(r.y+r.height).toBeLessThanOrEqual(e.height-75);
 const close=root.getByRole('button',{name:'关闭小地图',exact:true}),b=await close.boundingBox();if(!b)throw Error('GF_CLOSE_BOUNDS');expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);
 expect(await close.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native close target unoccluded').toBe(true);
 const toolbar=s.page.locator('[data-toolbar="bottom-toolbar"]'),tb=await toolbar.boundingBox();if(!tb)throw Error('GF_ACTUAL_TOOLBAR_BOUNDS');
 const overlap={width:Math.max(0,Math.min(r.x+r.width,tb.x+tb.width)-Math.max(r.x,tb.x)),height:Math.max(0,Math.min(r.y+r.height,tb.y+tb.height)-Math.max(r.y,tb.y))};
 console.log('GF_TOOLBAR_OCCLUSION',JSON.stringify({...e,map:r,toolbar:tb,overlap,docked:!!dock}));
 expect(overlap.width*overlap.height,'actual toolbar must not obscure minimap').toBe(0);
 const map=root.getByTestId('canvas-minimap-map'),mb=await map.boundingBox();if(!mb)throw Error('GF_MAP_LOW_POINT_BOUNDS');
 const low={x:Math.round(mb.x+132),y:Math.round(mb.y+112)};
 expect(await map.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),low),'map lower area remains actual hit target').toBe(true);
 if(dock){const before=await geView(s);if(!before)throw Error('GF_PUBLIC_VIEW_REQUIRED');const scale=Math.min(156/(e.width-(e.collapsed?20:480)),104/e.height),want={offsetX:before.offsetX+(88-(low.x-mb.x))/scale,offsetY:before.offsetY+(62-(low.y-mb.y))/scale};await s.page.touchscreen.tap(low.x,low.y);await settle(s.page);await expect.poll(async()=>(await geView(s))?.offsetX,{timeout:1500}).toBeCloseTo(want.offsetX,3);expect((await geView(s))?.offsetY).toBeCloseTo(want.offsetY,3);expect((await geView(s))?.zoom).toBe(1);}
 console.log('GF_GEOMETRY',JSON.stringify({...e,map:r,close:b,dock:dock?await dock.boundingBox():null,reservedRightNotRenderedSidebar:occupied}));
}
for(const e of geCases)it(`GF ${e.theme} ${e.width}x${e.height} empty collapsed=${e.collapsed} real bottom panels`,async()=>{
 await withSession(e.theme,e.width,e.height,{touch:true,collapsed:e.collapsed},async s=>{
  const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(before.images).toEqual([]);expect(await s.page.locator('[data-workspace-right-panel]').count(),'fixture does not render real right sidebar').toBe(0);
  try{
   if(!e.available){await geCommand(s,null);expect(await s.page.locator('[data-canvas-minimap]').count()).toBe(0);expect(await geView(s)).toEqual(before.view);return;}
   await geCommand(s,'打开小地图');const root=s.page.getByRole('region',{name:'画布小地图',exact:true});await root.waitFor({state:'visible'});expect(await root.getAttribute('data-theme')).toBe(e.theme==='mono'?'mono':'dark');
   expect(await root.getByText('暂无画布内容',{exact:true}).isVisible()).toBe(true);expect(await root.locator('[data-canvas-minimap-item]').count()).toBe(0);await geMapBounds(s,e,root);await geCapture(s,e,'empty-open');
   const map=root.getByTestId('canvas-minimap-map'),mb=await map.boundingBox();if(!mb)throw Error('GF_MAP_BOUNDS');expect(mb.width).toBe(176);expect(mb.height).toBe(124);
   const usable=e.width-(e.collapsed?20:480),scale=Math.min(156/usable,104/e.height),offsetX=88-usable*scale/2,offsetY=62-e.height*scale/2;
   const point={x:Math.round(mb.x+132),y:Math.round(mb.y+45)},expected={offsetX:usable/2-(point.x-mb.x-offsetX)/scale,offsetY:e.height/2-(point.y-mb.y-offsetY)/scale,zoom:1};
   expect(await map.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),point)).toBe(true);await s.page.touchscreen.tap(point.x,point.y);await settle(s.page);
   await expect.poll(async()=>(await geView(s))?.offsetX,{timeout:1500}).toBeCloseTo(expected.offsetX,3);const navigated=await geView(s);expect(navigated?.offsetY).toBeCloseTo(expected.offsetY,3);expect(navigated?.zoom).toBe(1);
   await geCommand(s,'打开图层面板');const layer=s.page.locator('[data-popup="layer-panel"]');await layer.waitFor({state:'visible'});expect(await layer.getByText('暂无图层',{exact:true}).isVisible()).toBe(true);await geMapBounds(s,e,root,layer);await geCapture(s,e,'real-layer-dock');
   await geCommand(s,'打开版本历史');const history=s.page.getByRole('dialog',{name:'版本历史',exact:true});await history.waitFor({state:'visible'});expect(await layer.count(),'docks remain mutually exclusive').toBe(0);await geMapBounds(s,e,root,history);await geCapture(s,e,'real-history-dock');
   const afterDockNavigation=await geView(s);expect(afterDockNavigation).not.toEqual(navigated);await geTap(s,history.getByRole('button',{name:'关闭版本历史',exact:true}));await history.waitFor({state:'detached'});await geMapBounds(s,e,root);expect(await geView(s)).toEqual(afterDockNavigation);
   await geTap(s,root.getByRole('button',{name:'关闭小地图',exact:true}));await root.waitFor({state:'detached'});expect(await s.page.evaluate(()=>localStorage.getItem('wujie.canvas.minimap.open.v1'))).toBe('false');
   expect(await geView(s)).toEqual(afterDockNavigation);const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual([]);expect(after.groups).toEqual([]);expect(after.actions).toEqual([]);
   console.log('GF_NEW_BOUNDARIES',JSON.stringify({...e,emptyNavigation:true,actualLayerAndHistoryAvoidance:true,realRightSidebarAccepted:false,notWholeC49OrMobileAcceptance:true}));
  }finally{await geCapture(s,e,'end-or-failure');}
 });
},25000);
async function pwTouchControl(s:Session,control:Locator):Promise<void>{
 await control.scrollIntoViewIfNeeded();
 await expect.poll(()=>control.evaluate(el=>{let opacity=1;for(let p:Element|null=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);return opacity;}),{timeout:1500}).toBeGreaterThanOrEqual(.99);
 const point=await control.evaluate(el=>{const r=el.getBoundingClientRect();let opacity=1;for(let p:Element|null=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);const x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom,opacity,hit:el.contains(document.elementFromPoint(x,y))};});
 const v=s.page.viewportSize()!;
 expect(point.width,'PW touch width').toBeGreaterThanOrEqual(44);expect(point.height,'PW touch height').toBeGreaterThanOrEqual(44);
 expect(point.left).toBeGreaterThanOrEqual(0);expect(point.top).toBeGreaterThanOrEqual(0);expect(point.right).toBeLessThanOrEqual(v.width);expect(point.bottom).toBeLessThanOrEqual(v.height);
 expect(point.opacity,'PW effective target opacity').toBeGreaterThanOrEqual(.99);expect(point.hit,'PW native target is unoccluded').toBe(true);
 await geTap(s,control);
}
async function pwTool(s:Session,title:string):Promise<void>{
 await pwTouchControl(s,s.page.locator('[data-toolbar="bottom-toolbar"]').getByTitle(title,{exact:true}));
}
// Read geometry only. Revealing a target here would hide a product scrolling bug.
async function pwReadEditorVisibility(control:Locator,interactive=true):Promise<{fullyVisible:boolean;touchSized:boolean;[key:string]:unknown}>{
 return control.evaluate((el,interactive)=>{
  const r=el.getBoundingClientRect(),v=window.visualViewport;
  let left=v?.offsetLeft??0,top=v?.offsetTop??0,right=left+(v?.width??innerWidth),bottom=top+(v?.height??innerHeight),opacity=1;
  for(let p:Element|null=el;p;p=p.parentElement){
   const style=getComputedStyle(p);opacity*=Number(style.opacity);
   if(p!==el){const b=p.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(style.overflowX)){left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}if(/hidden|auto|scroll|clip/.test(style.overflowY)){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}}
  }
  const inset=Math.min(12,r.width/4,r.height/4),cx=r.left+r.width/2,cy=r.top+r.height/2;
  const points=[[cx,r.top+inset],[cx,r.bottom-inset],[r.left+inset,cy],[r.right-inset,cy],[cx,cy]];
  const hits=points.map(([x,y])=>el.contains(document.elementFromPoint(x,y)));
  const rect={left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
  return{rect,clip:{left,top,right,bottom},opacity,hits,fullyVisible:r.width>0&&r.height>0&&r.left>=left&&r.top>=top&&r.right<=right&&r.bottom<=bottom&&opacity>=.99&&(!interactive||hits.every(Boolean)),touchSized:r.width>=44&&r.height>=44};
 },interactive);
}
async function pwScrollToolbar(s:Session,bar:Locator):Promise<{before:number;after:number}>{
 const auxiliary=bar.locator(':scope > [data-canvas-toolbar-auxiliary]');
 if(await auxiliary.count())bar=auxiliary;
 const bounds=await bar.boundingBox();if(!bounds)throw Error('PW_SCROLL_TOOLBAR_BOUNDS');
 const before=await bar.evaluate(e=>e.scrollLeft),maximum=await bar.evaluate(e=>e.scrollWidth-e.clientWidth);expect(maximum,'PW compact toolbar has real overflow').toBeGreaterThan(0);
 const client=await s.context.newCDPSession(s.page);let active=false,failed=false,primary:unknown;const cleanup:unknown[]=[];
 try{
  const forward=before<maximum/2,start={x:bounds.x+bounds.width*(forward ? 0.8 : 0.2),y:bounds.y+bounds.height/2},end={x:bounds.x+bounds.width*(forward ? 0.2 : 0.8),y:start.y};
  expect(await bar.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),start),'PW scroll starts on actual toolbar').toBe(true);
  active=true;await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
  for(let i=1;i<=6;i++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/6,y:start.y,id:1}]});await settle(s.page);}
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;
 }catch(error){failed=true;primary=error;}
 if(active){try{await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch(error){cleanup.push(error);}}
 try{await client.detach();}catch(error){cleanup.push(error);}
 if(failed||cleanup.length)throw new AggregateError([...(failed?[primary]:[]),...cleanup],'PW_NATIVE_SCROLL_AND_CLEANUP');
 await expect.poll(()=>bar.evaluate(e=>e.scrollLeft),{timeout:1500}).not.toBe(before);
 return{before,after:await bar.evaluate(e=>e.scrollLeft)};
}
async function pwTapEditorWithoutReveal(s:Session,control:Locator):Promise<void>{
 const visible=await pwReadEditorVisibility(control);
 expect(visible.fullyVisible,'editor tap requires an already visible target').toBe(true);
 expect(visible.touchSized,'editor tap preserves 44px touch targets').toBe(true);
 const box=await control.boundingBox();if(!box)throw Error('PW_EDITOR_TAP_BOUNDS');
 await s.page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await settle(s.page);
}
for(const theme of THEMES){
 it('PW '+theme+' short touch viewport keeps both panel entry directions usable',async()=>{
  const e:GECase={theme,width:844,height:390,collapsed:true,available:true};
  let bodyComplete=false;
  await withSession(theme,e.width,e.height,{touch:true,collapsed:true},async s=>{
   const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);
   const map=s.page.getByRole('region',{name:'画布小地图',exact:true});
   for(const kind of ['layer','history'] as const){
    const title=kind==='layer'?'打开图层':'版本历史',closeTitle=kind==='layer'?'关闭图层':'关闭版本历史';
    const dock=kind==='layer'?s.page.locator('[data-popup="layer-panel"]'):s.page.getByRole('dialog',{name:'版本历史',exact:true});
    await pwTool(s,'打开小地图');await map.waitFor({state:'visible'});await geMapBounds(s,e,map);
    await pwTool(s,title);await dock.waitFor({state:'visible'});await map.waitFor({state:'detached',timeout:1500});
    const d=await dock.boundingBox(),bar=await s.page.locator('[data-toolbar="bottom-toolbar"]').boundingBox();if(!d||!bar)throw Error('PW_DOCK_TOOLBAR_BOUNDS');
    expect(bar.y).toBeGreaterThanOrEqual(0);expect(bar.y+bar.height).toBeLessThanOrEqual(d.y-27);
    await pwTool(s,'打开小地图');await dock.waitFor({state:'detached',timeout:1500});await map.waitFor({state:'visible'});await geMapBounds(s,e,map);
    await pwTouchControl(s,map.getByRole('button',{name:'关闭小地图',exact:true}));await map.waitFor({state:'detached'});
    await pwTool(s,title);await dock.waitFor({state:'visible'});await pwTool(s,closeTitle);await dock.waitFor({state:'detached'});
   }
   const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.actions).toEqual([]);
   await geCapture(s,e,'pw-short-switches');console.log('PW_SHORT_SWITCHES_COMPLETE',JSON.stringify({theme,layerBothDirections:true,historyBothDirections:true,reopen:true,physicalAndroid:false,programmaticReveal:true}));bodyComplete=true;
  });
  expect(bodyComplete,'PW all short-switch assertions completed').toBe(true);
 },25000);
 it('PW '+theme+' retains layer and history drafts while resizing with the minimap opened last',async()=>{
  const e:GECase={theme,width:1040,height:720,collapsed:true,available:true};
  let bodyComplete=false;
  await withSession(theme,e.width,e.height,{touch:true,collapsed:true,seedImage:true},async s=>{
   const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);
   const map=s.page.getByRole('region',{name:'画布小地图',exact:true});
   const visibilityFailures:unknown[]=[];
   const visibilityChecks:unknown[]=[];
   for(const kind of ['layer','history'] as const){
    const title=kind==='layer'?'打开图层':'版本历史',closeTitle=kind==='layer'?'关闭图层':'关闭版本历史';
    const dock=kind==='layer'?s.page.locator('[data-popup="layer-panel"]'):s.page.getByRole('dialog',{name:'版本历史',exact:true});
    await pwTool(s,title);await dock.waitFor({state:'visible'});await pwTool(s,'打开小地图');await map.waitFor({state:'visible'});
    if(kind==='layer'){
     await pwTouchControl(s,dock.getByRole('button',{name:'图层 PW 原始图层 更多操作',exact:true}));
     await pwTouchControl(s,dock.getByRole('button',{name:'重命名',exact:true}));
    }else await pwTouchControl(s,dock.getByTitle('从此节点创建分支',{exact:true}));
    const input=kind==='layer'?dock.locator('input').first():dock.getByPlaceholder('分支名称（可选）',{exact:true});
    const draft='PW '+theme+' '+kind+' 未提交草稿';await input.fill(draft);
    await s.page.setViewportSize({width:844,height:390});await map.waitFor({state:'detached',timeout:1500});await settle(s.page);
    expect(await dock.count(),'editing dock remains mounted').toBe(1);expect(await input.inputValue(),'resize preserves unsaved text').toBe(draft);
    expect((await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state)).images).toEqual(before.images);
    const controls=kind==='layer'?[['input',input],['save',dock.getByRole('button',{name:'保存重命名',exact:true})],['cancel',dock.getByRole('button',{name:'取消重命名',exact:true})]] as const:[['card',input.locator('..')],['input',input],['close',dock.getByRole('button',{name:'关闭创建分支',exact:true})],['cancel',input.locator('..').getByRole('button',{name:'取消',exact:true})],['create',input.locator('..').getByRole('button',{name:'创建',exact:true})]] as const;
    for(const [name,control]of controls){const visibility=await pwReadEditorVisibility(control,name!=='card');const check={kind,name,...visibility};visibilityChecks.push(check);if(!visibility.fullyVisible||(name!=='card'&&!visibility.touchSized))visibilityFailures.push(check);}
    const barRect=await s.page.locator('[data-toolbar="bottom-toolbar"]').boundingBox(),dockRect=await dock.boundingBox();if(!barRect||!dockRect)throw Error('PW_EDITING_TOOLBAR_BOUNDS');
    console.log('PW_EDITOR_VISIBILITY',JSON.stringify({theme,kind,checks:visibilityChecks.filter(check=>(check as {kind:string}).kind===kind),barRect,dockRect,passiveGeometryOnly:true}));
    expect(visibilityFailures,'short-screen editor controls must be fully visible without test scrolling').toEqual([]);
    expect(barRect.y,'editing keeps toolbar inside viewport').toBeGreaterThanOrEqual(0);expect(barRect.y+barRect.height).toBeLessThanOrEqual(dockRect.y-27);
    expect(await input.evaluate(el=>document.activeElement===el),'resizing never blurs or commits the draft').toBe(true);
    await geCapture(s,{...e,width:844,height:390},'pw-'+kind+'-draft-preserved');
    await pwTapEditorWithoutReveal(s,dock.getByRole('button',{name:kind==='layer'?'取消重命名':'关闭创建分支',exact:true}));await input.waitFor({state:'detached'});
    await s.page.setViewportSize({width:e.width,height:e.height});await settle(s.page);
    await pwTool(s,closeTitle);await dock.waitFor({state:'detached'});
   }
   const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.groups).toEqual(before.groups);expect(after.actions).toEqual([]);
   await s.page.setViewportSize({width:768,height:1024});await settle(s.page);
   await geCommand(s,'打开图层面板');await geCommand(s,'打开小地图');await map.waitFor({state:'visible'});
   const viewBeforeScroll=await geView(s);
   const scroll=await pwScrollToolbar(s,s.page.locator('[data-toolbar="bottom-toolbar"]'));
   expect(await geView(s),'toolbar scrolling never pans the canvas').toEqual(viewBeforeScroll);
   expect(await s.page.locator('[data-popup="layer-panel"]').count()).toBe(1);expect(await map.count()).toBe(1);
   const final=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(final.images).toEqual(before.images);expect(final.groups).toEqual(before.groups);expect(final.actions).toEqual([]);
   await geCapture(s,{...e,width:768,height:1024},'pw-native-toolbar-scroll');
   console.log('PW_DRAFT_VISIBILITY',JSON.stringify({theme,visibilityFailures,passiveGeometryOnly:true}));expect(visibilityFailures,'short-screen editor controls must be fully visible without test scrolling').toEqual([]);
   console.log('PW_DRAFTS_COMPLETE',JSON.stringify({theme,layerPreserved:true,historyPreserved:true,passiveShortScreenVisibility:true,shortScreenNativeCancel:true,explicitCancel:true,noSaveOrRestore:true,nativeToolbarScroll:{viewport:{width:768,height:1024},...scroll},viewUnchanged:true,physicalAndroid:false,softKeyboardAccepted:false}));bodyComplete=true;
  });
  expect(bodyComplete,'PW both draft assertions completed').toBe(true);
 },25000);
}
