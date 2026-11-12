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
const DG_GLTF="{\"asset\":{\"version\":\"2.0\",\"generator\":\"owned-mobile-UI-geometry-only\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,\"NORMAL\":1},\"indices\":2,\"material\":0,\"mode\":4}]}],\"materials\":[{\"pbrMetallicRoughness\":{\"baseColorFactor\":[1,0.34,0.03,1],\"metallicFactor\":0,\"roughnessFactor\":0.75},\"doubleSided\":true}],\"buffers\":[{\"byteLength\":648,\"uri\":\"data:application/octet-stream;base64,AACAvwAAgL8AAIA/AACAPwAAgL8AAIA/AACAPwAAgD8AAIA/AACAvwAAgD8AAIA/AACAPwAAgL8AAIC/AACAvwAAgL8AAIC/AACAvwAAgD8AAIC/AACAPwAAgD8AAIC/AACAPwAAgL8AAIA/AACAPwAAgL8AAIC/AACAPwAAgD8AAIC/AACAPwAAgD8AAIA/AACAvwAAgL8AAIC/AACAvwAAgL8AAIA/AACAvwAAgD8AAIA/AACAvwAAgD8AAIC/AACAvwAAgD8AAIA/AACAPwAAgD8AAIA/AACAPwAAgD8AAIC/AACAvwAAgD8AAIC/AACAvwAAgL8AAIC/AACAPwAAgL8AAIC/AACAPwAAgL8AAIA/AACAvwAAgL8AAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAABAAIAAAACAAMABAAFAAYABAAGAAcACAAJAAoACAAKAAsADAANAA4ADAAOAA8AEAARABIAEAASABMAFAAVABYAFAAWABcA\"}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":288,\"target\":34962},{\"buffer\":0,\"byteOffset\":288,\"byteLength\":288,\"target\":34962},{\"buffer\":0,\"byteOffset\":576,\"byteLength\":72,\"target\":34963}],\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":24,\"type\":\"VEC3\",\"min\":[-1,-1,-1],\"max\":[1,1,1]},{\"bufferView\":1,\"componentType\":5126,\"count\":24,\"type\":\"VEC3\"},{\"bufferView\":2,\"componentType\":5123,\"count\":36,\"type\":\"SCALAR\"}]}";
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
 const [images,setImages]=useState<CanvasImage[]>([{id:'br-A',url:png,threeDModelUrl:'/dg-owned-cube.gltf',threeDModelUrls:{gltf:'/dg-owned-cube.gltf'},x:100,y:160,width:56,height:56,name:'BW A',prompt:'BR成员A'},{id:'br-B',url:png,x:100,y:270,width:56,height:56,name:'BW B',prompt:'BR成员B'},{id:'br-keep',url:png,x:100,y:380,width:56,height:56,name:'BW 保留',prompt:'BR组外素材'}]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;const [groups,setGroups]=useState<Array<{id:string;name:string;note:string;imageIds:string[];x:number;y:number;collapsed:boolean}>>([]);state.groups=groups;
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
        if (url.origin !== ORIGIN || url.username || url.password || (request.method() !== 'GET' && !(request.method() === 'HEAD' && url.pathname === '/dg-owned-cube.gltf' && !url.search)) || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > (key==='/dg-owned-cube.gltf'?2:['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/dg-owned-cube.gltf') { await route.fulfill({status:200,contentType:'model/gltf+json',headers:{'content-length':String(Buffer.byteLength(DG_GLTF))},body:request.method()==='HEAD'?'':DG_GLTF});return; }
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
  const allowed=['/dg-owned-cube.gltf','/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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










interface DGEntry {theme:Theme;width:number;height:number;variant:'controls'|'escape'}
const dgMatrix:DGEntry[]=THEMES.flatMap<DGEntry>(theme=>[[320,640],[375,812],[390,844],[640,320]].map(([width,height])=>({theme,width,height,variant:'controls' as const}))).concat(THEMES.map(theme=>({theme,width:375,height:812,variant:'escape' as const})));
interface DGPixels {viewRotation:number[];cameraDistance:number;hash:number;orange:number;centroidX:number;centroidY:number;width:number;height:number;bounds:{width:number;height:number}}
async function dgPrepare(c:Locator):Promise<void>{await c.scrollIntoViewIfNeeded();}
async function dgTap(s:Session,c:Locator):Promise<void>{await dgPrepare(c);await c.tap();await settle(s.page);}
async function dgFrames(page:Page,n=6):Promise<void>{await page.evaluate(async count=>{for(let i=0;i<count;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));},n);}
async function dgCapture(s:Session,e:DGEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/canvas-model-viewer-dg-native-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+e.variant+'-'+label+'.png');await s.page.screenshot({path:file});console.log('DG_CAPTURE',JSON.stringify({path:file,label,noProviderGenerationOrDeviceProof:true}));}
async function dgAudit(c:Locator):Promise<void>{await dgPrepare(c);const v=await c.evaluate(el=>{const r=el.getBoundingClientRect(),faults:string[]=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.left<r.left-.5||b.right>r.right+.5||b.top<r.top-.5||b.bottom>r.bottom+.5)faults.push('text-clipped');}return {name:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'',width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),faults};});console.log('DG_CONTROL',JSON.stringify(v));expect.soft(v.width,v.name+' width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' visible native hit').toBe(true);expect.soft(v.name,'accessible purpose').not.toBe('');expect.soft(v.faults,v.name+' readable').toEqual([]);}
async function dgPixels(canvas:Locator):Promise<DGPixels>{await dgPrepare(canvas);return canvas.evaluate(el=>{const c=el as HTMLCanvasElement,gl=c.getContext('webgl2');if(!gl)throw Error('DG_REAL_WEBGL_CONTEXT_REQUIRED');const p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);let hash=2166136261,count=0,sumX=0,sumY=0,minX=c.width,maxX=0,minY=c.height,maxY=0;for(let i=0;i<p.length;i++)hash=Math.imul(hash^p[i],16777619);for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(p[i]>100&&p[i]>p[i+1]+20&&p[i+1]>p[i+2]+10){count++;sumX+=x;sumY+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}const program=gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram|null;if(!program)throw Error('DG_NATIVE_RENDER_PROGRAM');const location=gl.getUniformLocation(program,'viewMatrix')??gl.getUniformLocation(program,'modelViewMatrix');const matrix=location?gl.getUniform(program,location) as Float32Array:null;if(!matrix||matrix.length!==16)throw Error('DG_PUBLIC_MODEL_VIEW_UNIFORM');const viewRotation=[0,1,2,4,5,6,8,9,10].map(i=>matrix[i]);const cameraDistance=Math.hypot(matrix[12],matrix[13],matrix[14]);const r=c.getBoundingClientRect(),sx=r.width/c.width,sy=r.height/c.height;return {viewRotation,cameraDistance,hash:hash>>>0,orange:count,centroidX:count?sumX/count*sx:0,centroidY:count?sumY/count*sy:0,width:r.width,height:r.height,bounds:{width:count?(maxX-minX+1)*sx:0,height:count?(maxY-minY+1)*sy:0}};});}
async function dgGesture(s:Session,canvas:Locator,kind:'drag'|'pinch'):Promise<void>{await dgPrepare(canvas);const b=await canvas.boundingBox();if(!b)throw Error('DG_NATIVE_CANVAS_BOUNDS');const x=b.x+b.width/2,y=b.y+b.height/2,c=await s.context.newCDPSession(s.page);let active=false;try{const points=(t:number)=>kind==='drag'?[{x:x+32*t,y,id:1,force:1}]:[{x:x-20-6*t,y,id:1,force:1},{x:x+20+6*t,y,id:2,force:1}];await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});active=true;for(const t of [.25,.5,.75,1]){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(t)});await settle(s.page);}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;}finally{try{if(active)await c.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}finally{await c.detach();}}await dgFrames(s.page);}
async function dgView(s:Session,panel:Locator,label:string):Promise<void>{await dgTap(s,panel.getByTitle('预设视角',{exact:true}));const choice=panel.getByRole('button',{name:label,exact:true});await choice.waitFor({state:'visible'});await dgTap(s,choice);await dgFrames(s.page);}
for(const e of dgMatrix)it('DG '+e.theme+' '+e.width+'x'+e.height+' '+e.variant+' actual parent owned glTF rendering and mobile controls',async()=>{await withSession(e.theme,e.width,e.height,{touch:true},async s=>{const before=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);try{const badge=s.page.locator('[data-canvas-image-id="br-A"]').locator('button').first();await dgAudit(badge);expect.soft(await badge.getAttribute('aria-label'),'badge names 3D preview action').toBe('预览3D模型');await badge.tap();const overlay=s.page.locator('[data-modal="3d-model-viewer"]'),panel=overlay.locator('>div >div');await overlay.waitFor({state:'visible'});const faces=panel.getByText('面数',{exact:true}).locator('..').locator('span').last(),vertices=panel.getByText('顶点',{exact:true}).locator('..').locator('span').last();await expect.poll(()=>faces.textContent(),{timeout:1500,message:'actual owned cube decoded'}).toBe('12');expect(await vertices.textContent()).toBe('24');await panel.getByText('加载 3D 模型中...',{exact:true}).waitFor({state:'detached'});const canvas=panel.locator('canvas');await dgFrames(s.page);const initial=await dgPixels(canvas);expect(initial.orange,'actual geometry pixels, not empty canvas').toBeGreaterThan(50);expect.soft(await panel.getAttribute('role'),'viewer dialog semantics').toBe('dialog');await dgCapture(s,e,'loaded');
 if(e.variant==='escape'){const focus=panel.getByRole('button',{name:'关闭3D模型预览',exact:true});await dgPrepare(focus);await focus.focus();expect(await focus.evaluate(el=>document.activeElement===el),'focus is inside actual viewer').toBe(true);await s.page.keyboard.press('Escape');await overlay.waitFor({state:'detached'});console.log('DG_ESCAPE_COMPLETE',JSON.stringify({...e,realModelLoaded:true,escapeClosed:true}));}
 else{const controls=panel.locator('button');for(let i=0;i<await controls.count();i++)await dgAudit(controls.nth(i));expect.soft(await panel.getByText(/单指旋转/).count(),'mobile guidance describes touch').toBeGreaterThan(0);await dgTap(s,panel.getByTitle('隐藏侧栏',{exact:true}));expect.soft(await panel.getByTitle('显示侧栏',{exact:true}).getAttribute('aria-expanded'),'sidebar collapsed').toBe('false');expect(await panel.getByAltText('Source',{exact:true}).count()).toBe(0);await dgTap(s,panel.getByTitle('显示侧栏',{exact:true}));expect(await panel.getByAltText('Source',{exact:true}).count()).toBe(1);const solid=await dgPixels(canvas);await dgTap(s,panel.getByTitle('线框模式',{exact:true}));expect.soft(await panel.getByTitle('实体模式',{exact:true}).getAttribute('aria-pressed'),'wireframe selection exposed').toBe('true');await dgFrames(s.page);const wire=await dgPixels(canvas);expect.soft(wire.hash,'wireframe changes actual rendered pixels').not.toBe(solid.hash);await dgTap(s,panel.getByTitle('实体模式',{exact:true}));await dgTap(s,panel.getByTitle('柔和光',{exact:true}));expect.soft(await panel.getByTitle('柔和光',{exact:true}).getAttribute('aria-pressed'),'light selection exposed').toBe('true');await dgTap(s,panel.getByTitle('户外光',{exact:true}));await dgTap(s,panel.getByTitle('影棚光',{exact:true}));await dgTap(s,panel.getByTitle('网格',{exact:true}));const spinBefore=await dgPixels(canvas);await dgTap(s,panel.getByTitle('自动旋转',{exact:true}));expect.soft(await panel.getByTitle('自动旋转',{exact:true}).getAttribute('aria-pressed'),'automatic rotation selected').toBe('true');const spinA=await dgPixels(canvas);await dgFrames(s.page,8);const spinB=await dgPixels(canvas);expect.soft(spinB.hash,'automatic rotation changes actual image').not.toBe(spinA.hash);expect.soft(Math.abs(spinB.cameraDistance-spinBefore.cameraDistance),'automatic rotation does not introduce zoom').toBeLessThan(.01);await dgTap(s,panel.getByTitle('网格',{exact:true}));await dgTap(s,panel.getByTitle('自动旋转',{exact:true}));await dgTap(s,panel.getByTitle('网格',{exact:true}));expect.soft(await panel.getByTitle('网格',{exact:true}).getAttribute('aria-pressed'),'grid off state exposed').toBe('false');
 await dgView(s,panel,'正面');const front=await dgPixels(canvas);await dgGesture(s,canvas,'drag');const rotated=await dgPixels(canvas);expect.soft(rotated.hash,'native single finger rotates actual geometry').not.toBe(front.hash);await dgView(s,panel,'正面');const repeated=await dgPixels(canvas);expect.soft(Math.abs(repeated.bounds.width-front.bounds.width),'same preset re-applies after manual rotation width').toBeLessThanOrEqual(3);expect.soft(Math.abs(repeated.bounds.height-front.bounds.height),'same preset re-applies after manual rotation height').toBeLessThanOrEqual(3);
 await dgView(s,panel,'背面');await dgView(s,panel,'正面');await dgTap(s,panel.getByRole('button',{name:'平移',exact:true}));expect.soft(await panel.getByRole('button',{name:'平移',exact:true}).getAttribute('aria-pressed'),'pan selection exposed').toBe('true');const panA=await dgPixels(canvas);await dgGesture(s,canvas,'drag');const panB=await dgPixels(canvas);expect.soft(panB.centroidX-panA.centroidX,'native one-finger pan moves the subject right').toBeGreaterThan(16);expect.soft(Math.max(...panB.viewRotation.map((v,i)=>Math.abs(v-panA.viewRotation[i]))),'pan keeps camera orientation rather than rotating').toBeLessThan(.01);const zoomA=await dgPixels(canvas);await dgGesture(s,canvas,'pinch');const zoomB=await dgPixels(canvas);expect.soft(zoomB.orange,'native two-finger spread zooms actual model').toBeGreaterThan(zoomA.orange*1.1);await dgTap(s,panel.getByRole('button',{name:'重置',exact:true}));await dgCapture(s,e,'operations');console.log('DG_OPERATIONS_OBSERVED',JSON.stringify({...e,initial,wire,spinBefore,spinA,spinB,front,rotated,repeated,panA,panB,zoomA,zoomB,publicLocatorScrollPreparationNotTouchScrollAcceptance:true,noScreenshotPublishDownloadOrModelPostProcess:true}));await dgTap(s,panel.getByRole('button',{name:'关闭3D模型预览',exact:true}));await overlay.waitFor({state:'detached'});}
 const after=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state);expect(after.images).toEqual(before.images);expect(after.view).toEqual(before.view);expect(after.actions).toEqual([]);await nativeRequestsFinished(s);const modelReads=[...s.completed].filter(r=>r.url()===ORIGIN+'/dg-owned-cube.gltf').map(r=>r.method()).sort();expect(modelReads).toEqual(['GET','HEAD']);expect(s.counts.get('/dg-owned-cube.gltf')).toBe(2);console.log('DG_COMPLETE',JSON.stringify({...e,realGeometryDecoded:true,faces:12,vertices:24,modelReads,sourceAndViewUnchanged:true,noAiServiceOrPaidOperation:true}));}finally{await dgCapture(s,e,'end-or-failure');}});},25000);
