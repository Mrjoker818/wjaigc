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
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
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
import {ImageEditor} from '@/components/image-editor';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('CANVAS_UI_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const manager=new TreeHistoryManager();
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const base={url:png,prompt:'BF合成主图',x:120,y:110,width:64,height:64,originalWidth:64,originalHeight:64};ctx!.fillStyle='#416b9c';ctx!.fillRect(0,0,64,64);const refPng=picture.toDataURL();
 const [images,setImages]=useState<CanvasImage[]>([{...base,id:'bf-main'},{...base,id:'bf-reference',url:refPng,prompt:'BF合成参考图',x:230}]);const [selected,setSelected]=useState<CanvasImage|null>(null);const [editing,setEditing]=useState<{image:CanvasImage|null}|null>(null);state.images=images;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed isAdmin={admin}
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onEditImage={image=>{state.actions.push('language-edit');setEditing({image});}} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
 onSwitchToDashboard={action('dashboard')} onToggleVisionPrompt={action('omp')} onToggleSettings={action('settings')} onToggleTheme={action('theme')} onToggleUserManager={action('users')} onToggleAdminSystem={action('admin')} onToggleProjectData={action('projects')} onToggleFavorites={action('favorites')} onTogglePromptTemplate={action('templates')} onToggleHelp={action('external-help')} onSwitchToNodeMode={action('node')} onSwitchToWorkflowHub={action('workflow')}/>{editing&&<ImageEditor image={editing.image} canvasImages={images} themeStyle={theme==='mono'?'monochrome':'gold'} onClose={()=>{state.actions.push('language-close');setEditing(null);}} onConfirm={()=>{throw Error('BF_UNEXPECTED_RESULT_PUBLISH');}}/>}</>;
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
        if (count > (key==='/api/models?type=chat'?2:['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ contentType:'text/event-stream',body:'data: heartbeat\n\n' });return; }
        if(key==='/api/models?type=image'||key==='/api/models?type=chat'){const kind=key.endsWith('image')?'image':'chat';await route.fulfill({json:{success:true,providers:[{id:'be-primary',name:'合成供应商甲',isEnabled:true},{id:'be-secondary',name:'合成供应商乙',isEnabled:true}],models:[{id:'be-'+kind+'-primary',model:'be-'+kind+'-primary',name:'合成'+kind+'主模型',providerId:'be-primary'},{id:'be-'+kind+'-secondary',model:'be-'+kind+'-secondary',name:'合成'+kind+'备模型',providerId:'be-secondary'}],capabilityCatalogVersion:1,taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return;}
        if(key==='/api/edit'){await route.fulfill({json:{supportedModels:['gpt-image-2','gemini-2.5-flash-image'],models:[{id:'gpt-image-2',name:'BF涂抹模型',providerId:'be-primary',providerName:'合成供应商甲',supportsMask:true},{id:'gpt-image-2',name:'BF涂抹模型',providerId:'be-secondary',providerName:'合成供应商乙',supportsMask:true},{id:'gemini-2.5-flash-image',name:'BF文字模型',providerId:'be-secondary',providerName:'合成供应商乙',supportsMask:false}]}});return;}
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { localStorage.setItem('wujie_prompt_templates',JSON.stringify([{id:'bf-local-template',name:'BF离线模板',content:'保留主体并更换背景',category:'编辑',tags:[],createdBy:'admin',createdAt:1,updatedAt:1,isGlobal:true}]));const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
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
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/api/models?type=image','/api/models?type=chat','/api/edit','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}const beforeDrain={pending:s.pending.size,failed:s.failed.size};try{await nativeRequestsFinished(s);console.log('BF_PRE_UNMOUNT_DRAIN',JSON.stringify({beforeDrain,afterDrain:{pending:s.pending.size,failed:s.failed.size},notHistoricalTrace:true}));}catch(drain){primary=primary?new AggregateError([primary,drain],'BF_SCENARIO_AND_PRE_UNMOUNT_DRAIN'):drain;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}

async function click(s:Session,b:Locator):Promise<void>{await reveal(s,b);const r=await b.boundingBox();if(!r)throw Error('BF_RECT');expect(await b.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native center hit').toBe(true);await s.page.mouse.click(r.x+r.width/2,r.y+r.height/2);await settle(s.page);}
async function reveal(s:Session,b:Locator):Promise<void>{for(let i=0;i<20;i++){const step=await b.evaluate(e=>{const r=e.getBoundingClientRect(),parents:HTMLElement[]=[];for(let p=e.parentElement;p;p=p.parentElement)parents.push(p);for(const p of parents.reverse()){const css=getComputedStyle(p),q=p.getBoundingClientRect(),top=Math.max(0,q.top+p.clientTop),bottom=Math.min(innerHeight,q.top+p.clientTop+p.clientHeight),left=Math.max(0,q.left+p.clientLeft),right=Math.min(innerWidth,q.left+p.clientLeft+p.clientWidth);let dx=0,dy=0;if(/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight){if(r.height<=bottom-top){if(r.top<top-.5)dy=r.top-top-3;else if(r.bottom>bottom+.5)dy=r.bottom-bottom+3;}else if(r.y+r.height/2<top+24||r.y+r.height/2>bottom-24)dy=r.y+r.height/2-(top+bottom)/2;}if(/auto|scroll/.test(css.overflowX)&&p.scrollWidth>p.clientWidth){if(r.left<left-.5)dx=r.left-left-3;else if(r.right>right+.5)dx=r.right-right+3;}if((dx||dy)&&bottom>top&&right>left)return {x:right-5,y:(top+bottom)/2,dx,dy};}return null;});if(!step)return;await s.page.mouse.move(step.x,step.y);await s.page.mouse.wheel(step.dx,step.dy);await settle(s.page);}throw Error('BF_BOUNDED_NATIVE_REVEAL');}
async function audit(s:Session,b:Locator,kind='control'):Promise<void>{await reveal(s,b);const v=await b.evaluate(e=>{const r=e.getBoundingClientRect(),css=getComputedStyle(e),faults:string[]=[];const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const g of range.getClientRects())if(g.left<r.left-.5||g.right>r.right+.5||g.top<r.top-.5||g.bottom>r.bottom+.5)faults.push('glyph-clipped');}return {tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,90)||e.getAttribute('placeholder'),width:r.width,height:r.height,font:Number.parseFloat(css.fontSize),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:[[r.x+r.width/2,r.y+r.height/2],[r.left+8,r.y+r.height/2],[r.right-8,r.y+r.height/2],[r.x+r.width/2,r.top+8],[r.x+r.width/2,r.bottom-8]].every(([x,y])=>e.contains(document.elementFromPoint(x,y))),faults};});console.log('BF_CONTROL',JSON.stringify({kind,...v}));expect.soft(v.width,v.name+' target width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' target height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' visible five-point target').toBe(true);expect.soft(v.faults,v.name+' complete glyphs').toEqual([]);if(['INPUT','SELECT','TEXTAREA'].includes(v.tag))expect.soft(v.font,v.name+' avoids mobile input zoom').toBeGreaterThanOrEqual(16);}

interface BFEntry {theme:Theme;width:number;height:number}
const MATRIX=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
let captureIndex=0;
function panel(s:Session):Locator{return s.page.locator('[data-popup]').filter({has:s.page.locator('[data-panel-header]').getByText('语言修图',{exact:true})});}
function prompt(s:Session):Locator{return panel(s).getByPlaceholder('描述修改内容，如：把背景换成日落... (输入 / 模板 · @ 引用图片)',{exact:true});}
function modelTrigger(s:Session,kind:'image'|'chat'):Locator{return panel(s).locator('button').filter({hasText:kind==='image'?/BF涂抹模型|BF文字模型/:/合成chat主模型|合成chat备模型/}).filter({has:s.page.locator('svg.lucide-chevron-down,svg.lucide-chevron-up')});}
async function capture(s:Session,e:BFEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/language-secondary-bf-native-20261019',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+(++captureIndex)+'-'+label+'.png');await s.page.screenshot({path:file});console.log('BF_CAPTURE',JSON.stringify({path:file,label,physicalAndroid:false,coze:false,fullCanvasWorkspace:false}));}
async function check(e:BFEntry,run:(s:Session)=>Promise<void>):Promise<void>{await withSession(e.theme,e.width,e.height,{},async s=>{try{await click(s,s.page.locator('[data-mobile-canvas-toolbar]').getByRole('button',{name:'全部工具',exact:true}));await click(s,s.page.getByRole('dialog',{name:'全部工具',exact:true}).getByRole('button',{name:'语言修图',exact:true}));await panel(s).waitFor();await s.page.waitForFunction(()=>document.body.textContent?.includes('BF涂抹模型')&&document.body.textContent?.includes('合成chat主模型'));await nativeRequestsFinished(s);await run(s);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images.map((x:unknown)=>(x as {id:string}).id))).toEqual(['bf-main','bf-reference']);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual({offsetX:0,offsetY:0,zoom:1});expect(s.counts.get('/api/edit')).toBe(1);await capture(s,e,'end');}catch(error){await capture(s,e,'failure');throw error;}});}
async function mainImage(s:Session):Promise<void>{const p=panel(s),add=p.getByRole('button',{name:'添加要修图的图片 从画布选择或上传本地图片',exact:true});await click(s,add);const pick=p.getByRole('button',{name:/^BF合成主图 64x64$/});await audit(s,pick,'main-picker');await click(s,pick);await p.getByRole('img',{name:'编辑',exact:true}).waitFor();await s.page.waitForFunction(()=>{const img=document.querySelector<HTMLImageElement>('img[alt="编辑"]');return img?.complete&&img.naturalWidth===64;});}
for(const e of MATRIX){const tag='BF '+e.theme+' '+e.width+'x'+e.height;
 it(tag+' prompt typing corner and expand control never overlap',async()=>{await check(e,async s=>{const input=prompt(s),expand=panel(s).getByRole('button',{name:'展开输入框',exact:true});await reveal(s,input);await input.fill('BF输入右下角仍可编辑');await reveal(s,expand);await audit(s,expand,'input-expansion');const geometry=await input.evaluate(el=>{const field=el.getBoundingClientRect(),button=el.parentElement!.querySelector('button[title="展开输入框"]')!.getBoundingClientRect(),w=Math.max(0,Math.min(field.right,button.right)-Math.max(field.left,button.left)),h=Math.max(0,Math.min(field.bottom,button.bottom)-Math.max(field.top,button.top));return {area:w*h,field:{x:field.x,y:field.y,width:field.width,height:field.height},button:{x:button.x,y:button.y,width:button.width,height:button.height}};});console.log('BF_PROMPT_TARGET_SEPARATION',JSON.stringify(geometry));expect(geometry.area,'separate typing and expansion targets').toBe(0);await click(s,expand);console.log('BF_EXPANSION_TRANSITION',JSON.stringify(await input.evaluate(el=>({beforeHeight:el.getBoundingClientRect().height,running:el.getAnimations().filter(a=>a.playState==='running').map(a=>({type:a.constructor.name,property:a instanceof CSSTransition?a.transitionProperty:null}))}))));await s.page.waitForFunction(()=>Array.from(document.querySelectorAll('textarea')).every(el=>el.getAnimations().every(a=>a.playState!=='running')),undefined,{timeout:1500});console.log('BF_EXPANSION_SETTLED',JSON.stringify(await input.evaluate(el=>({height:el.getBoundingClientRect().height,running:el.getAnimations().filter(a=>a.playState==='running').length}))));expect(await input.inputValue()).toBe('BF输入右下角仍可编辑');await audit(s,panel(s).getByRole('button',{name:'收起输入框',exact:true}));});},25000);

 it(tag+' main reference picker and removal are visible44px without image overlap',async()=>{await check(e,async s=>{await mainImage(s);const p=panel(s),replace=p.getByRole('button',{name:'更换图片',exact:true}),refs=p.getByRole('button',{name:'画布选图',exact:true});await audit(s,replace);await audit(s,refs);await click(s,refs);const pick=p.getByRole('button',{name:/^BF合成参考图 64x64$/});await audit(s,pick);await click(s,pick);const image=p.getByRole('img',{name:'参考1',exact:true});await image.waitFor();const card=image.locator('xpath=..'),remove=card.getByRole('button');await audit(s,remove,'reference-remove');expect.soft(await remove.getAttribute('aria-label'),'reference removal name').toBeTruthy();expect.soft(await remove.evaluate(el=>Number(getComputedStyle(el).opacity)),'reference remove visible at rest').toBe(1);await reveal(s,remove);const safe=await remove.evaluate(el=>{const r=el.getBoundingClientRect(),img=el.parentElement!.querySelector('img')!.getBoundingClientRect();return r.top>=img.bottom-.5||r.left>=img.right-.5||r.bottom<=img.top+.5;});expect.soft(safe,'separate image and removal').toBe(true);await capture(s,e,'reference');await click(s,remove);expect(await image.count()).toBe(0);});},25000);
 it(tag+' at image and slash template preserve local input and close popup without generation',async()=>{await check(e,async s=>{await mainImage(s);const p=panel(s),input=prompt(s);await audit(s,input,'prompt');await reveal(s,input);await input.fill('@');const item=p.getByRole('button',{name:/^#2 BF合成参考图 #2$/});await audit(s,item,'at-image');await click(s,item);expect(await input.inputValue()).toBe('@图片#2 ');expect(await p.getByRole('img',{name:'参考1',exact:true}).count()).toBe(1);await input.fill('/');await input.fill('/BF');const template=p.getByRole('button',{name:'BF离线模板 保留主体并更换背景',exact:true});await audit(s,template,'slash-template');await click(s,template);expect(await input.inputValue()).toBe('保留主体并更换背景');await input.fill('@');await input.press('Escape');expect(await p.getByText('输入 @ 引用画布图片作为参考',{exact:true}).count()).toBe(0);expect(await p.count()).toBe(1);await input.fill('/');await input.fill('/BF');await input.press('Escape');expect(await template.count()).toBe(0);expect(await p.count()).toBe(1);await capture(s,e,'popups-closed');});},25000);
 it(tag+' exact model pairs mask restriction prompt expansion and parameters remain operable',async()=>{await check(e,async s=>{await mainImage(s);const p=panel(s),trigger=modelTrigger(s,'image');await audit(s,trigger);await click(s,trigger);const row=p.getByRole('button').filter({hasText:'BF文字模型'}).filter({hasText:'合成供应商乙'});await audit(s,row,'unsupported-model-row');await click(s,row);expect(await trigger.textContent()).toContain('BF文字模型 (合成供应商乙)');expect(await trigger.textContent()).toContain('仅文字修图');expect(await s.page.evaluate(()=>localStorage.getItem('wujie_edit_selected_model'))).toBe('server::be-secondary::gemini-2.5-flash-image');const llm=modelTrigger(s,'chat');await audit(s,llm);await click(s,llm);const chat=p.getByRole('button').filter({hasText:'合成chat备模型'}).filter({hasText:'合成供应商乙'});await audit(s,chat);await click(s,chat);expect(await llm.textContent()).toContain('合成chat备模型 (合成供应商乙)');expect(await s.page.evaluate(()=>localStorage.getItem('wujie_edit_selected_llm'))).toBe('server::be-secondary::be-chat-secondary');for(const provider of ['合成供应商甲','合成供应商乙']){await click(s,trigger);const sameId=p.getByRole('button').filter({hasText:'BF涂抹模型'}).filter({hasText:provider});await audit(s,sameId,'same-id-provider');await click(s,sameId);expect(await trigger.textContent()).toContain('BF涂抹模型 ('+provider+')');expect(await s.page.evaluate(()=>localStorage.getItem('wujie_edit_selected_model'))).toBe('server::'+(provider.endsWith('甲')?'be-primary':'be-secondary')+'::gpt-image-2');const restored=p.locator('canvas');expect(await restored.evaluate(el=>getComputedStyle(el).pointerEvents)).not.toBe('none');await reveal(s,restored);const box=await restored.boundingBox();if(!box)throw Error('BF_MASK_RECT');const beforePixels=await restored.evaluate((el:HTMLCanvasElement)=>{const d=el.getContext('2d')!.getImageData(0,0,el.width,el.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>10)n++;return n;});await s.page.mouse.move(box.x+box.width*.4,box.y+box.height*.55);await s.page.mouse.down();await s.page.mouse.move(box.x+box.width*.6,box.y+box.height*.55,{steps:6});await s.page.mouse.up();await settle(s.page);const afterPixels=await restored.evaluate((el:HTMLCanvasElement)=>{const d=el.getContext('2d')!.getImageData(0,0,el.width,el.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>10)n++;return n;});expect(afterPixels,'real canvas mask restored '+provider).toBeGreaterThan(beforePixels);await click(s,p.getByRole('button',{name:'清除',exact:true}));}await click(s,trigger);await click(s,p.getByRole('button').filter({hasText:'BF文字模型'}).filter({hasText:'合成供应商乙'}));const brush=p.getByRole('button',{name:'画笔',exact:true});await audit(s,brush);await click(s,brush);const canvas=p.locator('canvas');expect(await canvas.evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');const expand=p.getByRole('button',{name:'展开输入框',exact:true});await audit(s,expand);await click(s,expand);await audit(s,p.getByRole('button',{name:'收起输入框',exact:true}));await click(s,p.getByRole('button',{name:'收起输入框',exact:true}));for(const select of await p.locator('select').all())await audit(s,select,'parameter');await click(s,p.getByRole('button',{name:'最小化语言修图',exact:true}));await click(s,p.getByRole('button',{name:'展开语言修图',exact:true}));expect(await trigger.textContent()).toContain('BF文字模型 (合成供应商乙)');expect(await llm.textContent()).toContain('合成chat备模型 (合成供应商乙)');});},25000);
}

