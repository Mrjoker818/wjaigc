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
import { FONT_STYLE_CATEGORIES, SCENE_MAP, STROKE_MAP, GRAPHIC_MAP, MATERIAL_MAP } from '@/app/api/font-design/plan/constants';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number}
const ORIGIN='https://canvas-shell-mobile.invalid';
const THEMES:readonly Theme[]=['gold','mono'];
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const EC_GALLERY_KEYS=['/api/font-design/gallery?page=1&pageSize=30','/api/font-design/gallery?page=2&pageSize=30','/api/font-design/gallery?category=fixture-title&page=1&pageSize=30','/api/font-design/gallery?page=1&search=%E6%96%87%E5%AD%97%E7%94%B2&pageSize=30'];
const EC_GET_KEYS=['/api/font-design/plan','/api/models?type=image',...EC_GALLERY_KEYS];
const ecOptions=(map:Record<string,string>):Array<{id:string;name:string;description:string}>=>Object.entries(map).map(([name,description])=>({id:name,name,description}));
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
        if (count > (key==='/logo.png'?2:EC_GALLERY_KEYS.includes(key)?6:['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
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
        if(key==='/api/font-design/plan'){await route.fulfill({json:{styleCategories:FONT_STYLE_CATEGORIES,scenes:ecOptions(SCENE_MAP),strokeOptions:ecOptions(STROKE_MAP),graphicElements:ecOptions(GRAPHIC_MAP),materials:ecOptions(MATERIAL_MAP)}});return;}
        if(key==='/api/models?type=image'){await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[{id:'ec-alpha',name:'alpha',displayName:'离线供应商甲'},{id:'ec-beta',name:'beta',displayName:'离线供应商乙'}],models:[{id:'ec-image',name:'离线字体模型',providerId:'ec-alpha'},{id:'ec-image',name:'离线字体模型',providerId:'ec-beta'}],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return;}
        if(EC_GALLERY_KEYS.includes(key)){const png='data:image/png;base64,'+s.png.toString('base64'),all=Array.from({length:31},(_,i)=>({id:'ec-'+i,imageFile:'owned.png',sourceUrl:png,localPath:png,prompt:'本地字体参考 '+i,displayText:i===0?'文字甲':'编号'+(i+1),category:i<16?'fixture-title':'fixture-logo',categoryName:i<16?'标题夹具':'标志夹具'})),category=url.searchParams.get('category'),search=url.searchParams.get('search')||'',page=Number(url.searchParams.get('page')),filtered=all.filter(v=>(!category||v.category===category)&&(!search||[v.prompt,v.displayText,v.categoryName].some(t=>t.toLowerCase().includes(search.toLowerCase()))));await route.fulfill({json:{categories:[{id:'fixture-title',name:'标题夹具',count:16},{id:'fixture-logo',name:'标志夹具',count:15}],totalCount:all.length,filteredCount:filtered.length,page,pageSize:30,totalPages:Math.ceil(filtered.length/30),items:filtered.slice((page-1)*30,page*30)}});return;}
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
  const allowed=[...EC_GET_KEYS,'/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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















interface ECEntry {theme:Theme;width:number;height:number;variant:'base'|'advanced'|'gallery'|'escape'}
const ecMatrix:ECEntry[]=THEMES.flatMap<ECEntry>(theme=>[[320,640],[390,844],[640,320]].flatMap(([width,height])=>(['base','advanced','gallery'] as const).map(variant=>({theme,width,height,variant})))).concat(THEMES.map(theme=>({theme,width:375,height:812,variant:'escape' as const})));
async function ecTap(s:Session,c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();await c.tap();await settle(s.page);}
async function ecCapture(s:Session,e:ECEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-font-design-ec-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+e.variant+'-'+label+'.png');await s.page.screenshot({path:file});console.log('EC_CAPTURE',JSON.stringify({path:file,label,offlineNotAndroidOrCloud:true}));}
async function ecSelected(c:Locator,attribute='aria-pressed',value='true'):Promise<void>{const initial=await c.getAttribute(attribute);if(initial===null){expect.soft(initial,'selection state '+await c.textContent()).toBe(value);return;}await expect.poll(()=>c.getAttribute(attribute),{timeout:1500}).toBe(value);}
async function ecAudit(root:Locator,controls:Locator):Promise<void>{const faults:Array<{name:string;width:number;height:number;inside:boolean;hit:boolean;opacity:number;textClipped:boolean}>=[];for(const c of await controls.all()){await c.scrollIntoViewIfNeeded();const v=await c.evaluate(el=>{const r=el.getBoundingClientRect();let opacity=1;for(let p:Element|null=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);let textClipped=false;const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=w.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const q of range.getClientRects())if(q.left<r.left-.5||q.right>r.right+.5||q.top<r.top-.5||q.bottom>r.bottom+.5)textClipped=true;}return {name:el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent?.trim()||'').filter(Boolean).join(' ')||(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?Array.from(el.labels||[]).map(label=>label.textContent?.trim()||'').join(' '):'')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),opacity,textClipped};});if(v.width<44||v.height<44||!v.inside||!v.hit||!v.name||v.opacity<.1||v.textClipped)faults.push(v);}console.log('EC_CONTROL_AUDIT',JSON.stringify({count:await controls.count(),faults}));expect.soft(faults,'44px named visible unobstructed readable controls').toEqual([]);const bounds=await root.boundingBox();expect.soft(Boolean(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=await root.page().evaluate(()=>innerWidth)&&bounds.y+bounds.height<=await root.page().evaluate(()=>innerHeight)),'font window remains inside viewport').toBe(true);}
async function ecFinger(s:Session,target:Locator,dy:number):Promise<void>{const r=await target.boundingBox();if(!r)throw Error('EC_TOUCH_BOUNDS');const heading=target.locator('h1'),isHeader=await heading.count()===1,headingBounds=isHeader?await heading.boundingBox():null;const start=headingBounds?{x:headingBounds.x+headingBounds.width/2,y:headingBounds.y+headingBounds.height/2}:{x:r.x+r.width-8,y:r.y+r.height*.65},cdp=await s.context.newCDPSession(s.page);let active=false;try{expect(await target.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return Boolean(hit&&el.contains(hit)&&!hit.closest('button,input,textarea,select'));},start),'native gesture begins on actual non-control surface').toBe(true);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,force:1}]});active=true;if(isHeader)expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.events.filter(e=>e.type==='pointerdown').at(-1)?.target),'actual native header touch lands on H1, not nearby button').toBe('H1');for(const f of [.25,.5,.75,1]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y+dy*f,id:1,force:1}]});await settle(s.page);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;}finally{try{if(active)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await cdp.detach();}}await settle(s.page);}
for(const e of ecMatrix)it('EC '+e.theme+' '+e.width+'x'+e.height+' '+e.variant+' actual parent font design',async()=>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);try{await ecTap(s,s.page.getByRole('button',{name:'全部工具',exact:true}));const drawer=s.page.locator('[data-mobile-canvas-toolbar-drawer]');await ecTap(s,drawer.getByRole('button',{name:'字境大师',exact:true}));const root=s.page.locator('[data-floating-panel]').filter({has:s.page.getByText('字境大师 Pro',{exact:true})});await root.waitFor();await root.getByRole('button',{name:'商业海报',exact:true}).waitFor();await nativeRequestsFinished(s);const close=root.getByTitle('关闭',{exact:true});await ecCapture(s,e,'opened');if(e.variant==='escape'){await close.focus();expect(await close.evaluate(el=>document.activeElement===el)).toBe(true);await s.page.keyboard.press('Escape');await root.waitFor({state:'detached'});}else{expect.soft(await root.getAttribute('role'),'font window accessible dialog').toBe('dialog');const title=root.getByPlaceholder('请输入中文标题、活动主题、封面标题或文字Logo名称'),model=root.locator('button').filter({hasText:'离线字体模型'}).first();if(e.variant==='base'){await ecAudit(root,root.locator('button,input,textarea'));await title.fill('手机字体验收');expect(await title.inputValue()).toBe('手机字体验收');const scene=root.getByRole('button',{name:'商业海报',exact:true});await ecTap(s,scene);await ecSelected(scene);expect(await root.getByRole('button',{name:'文字Logo',exact:true}).count()).toBe(2);await ecTap(s,root.getByRole('button',{name:'文字Logo',exact:true}).nth(1));const sub=root.getByRole('button',{name:'极简Logo',exact:true});await ecTap(s,sub);await ecSelected(sub);await ecTap(s,model);const rows=root.locator('div.absolute.top-full').getByRole('button');expect(await rows.count()).toBe(2);await ecAudit(root,rows);await ecTap(s,rows.filter({hasText:'离线供应商乙'}));expect(await model.textContent()).toContain('离线供应商乙');await ecTap(s,model);await ecSelected(rows.filter({hasText:'离线供应商乙'}));await ecSelected(rows.filter({hasText:'离线供应商甲'}),'aria-pressed','false');await ecTap(s,model);await title.scrollIntoViewIfNeeded();const body=root.locator('div.overflow-y-auto').first(),scrollBefore=await body.evaluate(el=>el.scrollTop);await ecFinger(s,body,-60);await expect.poll(()=>body.evaluate(el=>el.scrollTop),{timeout:1500}).toBeGreaterThan(scrollBefore+20);await ecTap(s,root.getByTitle('最小化',{exact:true}));expect(await title.count()).toBe(0);const header=root.locator(':scope > div').first(),y=(await root.boundingBox())!.y;await ecFinger(s,header,48);await expect.poll(async()=>(await root.boundingBox())!.y,{timeout:1500}).toBeGreaterThan(y+30);await ecAudit(root,root.locator('button'));await ecTap(s,root.getByTitle('展开',{exact:true}));expect(await title.inputValue()).toBe('手机字体验收');expect(await model.textContent()).toContain('离线供应商乙');}
else if(e.variant==='advanced'){await ecTap(s,root.getByRole('button',{name:'高级参数',exact:true}));await ecAudit(root,root.locator('button,input,textarea'));for(const name of ['1:1','◇ 透明Logo','透明背景','黑金背景']){const c=root.getByRole('button',{name,exact:true});await ecTap(s,c);await ecSelected(c);}for(const name of ['白色','黑色','金色','红色','黑金','红金','银色','渐变','霓虹蓝','暖橙']){const c=root.getByTitle(name,{exact:true});await ecTap(s,c);await ecSelected(c);}for(const group of ['笔画处理（多选）','图形融合（多选）','字体质感']){const box=root.getByText(group,{exact:true}).locator('..'),c=box.getByRole('button').first();await ecTap(s,c);await ecSelected(c);if(group.includes('多选')){await ecTap(s,c);await ecSelected(c,'aria-pressed','false');}}const toggle=root.getByText('即梦增强模式',{exact:true}).locator('../..').locator('button');expect(await toggle.getAttribute('role'),'enhancement is a named switch').toBe('switch');expect(await toggle.getAttribute('aria-label')).toBe('即梦增强模式');await ecSelected(toggle,'aria-checked');await ecTap(s,toggle);await ecSelected(toggle,'aria-checked','false');await ecTap(s,toggle);await ecSelected(toggle,'aria-checked');}
else {for(const name of ['即梦提示词','生成图片','历史记录','设计方案']){const tab=root.getByRole('button',{name,exact:true});await ecTap(s,tab);await ecSelected(tab);if(name==='历史记录')await root.getByText('暂无历史记录',{exact:true}).waitFor();}const tab=root.getByRole('button',{name:'灵感图库',exact:true});await ecTap(s,tab);await nativeRequestsFinished(s);await root.getByAltText('文字甲',{exact:true}).waitFor();const gallery=tab.locator('../..').locator(':scope > div').last();await ecAudit(root,gallery.getByRole('button').filter({hasText:/^(全部|标题夹具|标志夹具|上一页|下一页)/}));for(const mode of ['列表模式','大图模式','缩略图模式']){const c=root.getByTitle(mode,{exact:true});await ecTap(s,c);await ecSelected(c);await ecAudit(root,c);const action=root.getByRole('button',{name:mode==='列表模式'?'制作同款':'一键制作同款',exact:true}).first();await ecAudit(root,action);}await ecTap(s,root.getByRole('button',{name:'下一页',exact:true}));await nativeRequestsFinished(s);await root.getByAltText('编号31',{exact:true}).waitFor();expect(await root.getByRole('button',{name:'下一页',exact:true}).isDisabled()).toBe(true);await ecTap(s,root.getByRole('button',{name:'上一页',exact:true}));await nativeRequestsFinished(s);await root.getByAltText('文字甲',{exact:true}).waitFor();expect(await root.getByAltText('编号17',{exact:true}).count()).toBe(1);expect(await root.getByAltText(/^(文字甲|编号\d+)$/).count()).toBe(30);const category=root.getByRole('button',{name:'标题夹具(16)',exact:true});await ecTap(s,category);await nativeRequestsFinished(s);await expect.poll(()=>root.getByAltText(/^(文字甲|编号\d+)$/).count(),{timeout:1500}).toBe(16);await ecSelected(category);expect(await root.getByAltText('编号17',{exact:true}).count()).toBe(0);expect(await root.getByAltText('编号31',{exact:true}).count()).toBe(0);await ecTap(s,root.getByRole('button',{name:'全部',exact:true}));await nativeRequestsFinished(s);const search=root.getByPlaceholder('搜索关键词...');await search.fill('文字甲');await nativeRequestsFinished(s);await expect.poll(()=>root.getByRole('button',{name:'一键制作同款',exact:true}).count(),{timeout:1500}).toBe(1);const image=root.getByAltText('文字甲',{exact:true});await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth),{timeout:1500}).toBe(64);const selectedSource=await image.getAttribute('src');await ecTap(s,root.getByRole('button',{name:'一键制作同款',exact:true}));await root.getByText('灵感参考',{exact:true}).waitFor();expect(await root.getByAltText('灵感参考图').getAttribute('src')).toBe(selectedSource);await ecAudit(root,root.getByTitle('退出灵感模式',{exact:true}));await ecTap(s,root.getByTitle('退出灵感模式',{exact:true}));expect(await title.inputValue()).toBe('文字甲');expect([...s.counts.keys()].every(k=>!k.includes('generate-image'))).toBe(true);}
await ecCapture(s,e,'operations');await ecTap(s,close);await root.waitFor({state:'detached'});}const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);console.log('EC_COMPLETE',JSON.stringify({...e,bodyReachedNotGate:true,noGenerationOrProvider:true}));}finally{await ecCapture(s,e,'end-or-failure');}});},25000);
