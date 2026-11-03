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
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('CANVAS_UI_FIXTURE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const manager=new TreeHistoryManager();
const state={mounts:0,disposed:false,scopeChecks:0,images:[] as CanvasImage[],actions:[] as string[],view:null as {offsetX:number;offsetY:number;zoom:number}|null,events:[] as Array<{type:string,target:string}>};
const action=(name:string)=>()=>{state.actions.push(name);};
const observe=(e:Event)=>{const el=e.target as Element;state.events.push({type:e.type,target:el?.hasAttribute?.('data-canvas-viewport')?'canvas':el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const scope={actorId:'omp-mobile-user',projectId:'canvas-ui-project',key:'bb-native-scope',authority:'legacy' as const,assertCurrent(_write=false):void{const actor=localStorage.getItem('unbounded_ai_current_user'),stored=JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null'),project=document.querySelector('[data-canvas-viewport]')?.getAttribute('data-project-id');if(state.disposed||actor!==this.actorId||project!==this.projectId||!stored?.users?.some((u:{id:string;status:string})=>u.id===this.actorId&&u.status==='active'))throw Error('BB_SYNTHETIC_SCOPE_IDENTITY_CHANGED');state.scopeChecks++;}};
const sketchContext={key:scope.key,captureScope:()=>{scope.assertCurrent();return scope;},insert:async()=>{throw Error('BB_UNEXPECTED_INSERT');}};
function Entry({theme,admin,catalogLoading}:{theme:'gold'|'mono';admin:boolean;catalogLoading:boolean}):React.ReactElement{
 const [images,setImages]=useState<CanvasImage[]>([]);const [selected,setSelected]=useState<CanvasImage|null>(null);state.images=images;
 return <><OperationAuditClient/><InfiniteCanvas images={images} selectedImage={selected} projectId="canvas-ui-project" isPanelCollapsed isAdmin={admin}
 themeStyle={theme==='mono'?'monochrome':'gold'} initialViewState={{offsetX:0,offsetY:0,zoom:1}} onViewStateChange={view=>{state.view=view;}}
 versionHistoryManager={manager} sketchImageEnabled={true} sketchContext={sketchContext} catalogStatus={{loading:catalogLoading,error:null}} onImagesChange={setImages} onSelectImage={setSelected} onPreviewImage={action('preview')} onGenerateVariation={action('variation')} onExtractKeywords={action('keywords')} onFusion={action('fusion')} onAddImages={()=>{throw Error('CANVAS_UI_FIXTURE_UNEXPECTED_PUBLISH')}}
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
        if (key === '/api/task-events') { await route.fulfill({ contentType:'text/event-stream',body:'data: heartbeat\n\n' });return; }
        if(key==='/api/models?type=image'||key==='/api/models?type=chat'){const kind=key.endsWith('image')?'image':'chat';await route.fulfill({json:{success:true,providers:[{id:'be-primary',name:'合成供应商甲',isEnabled:true},{id:'be-secondary',name:'合成供应商乙',isEnabled:true}],models:[{id:'be-'+kind+'-primary',model:'be-'+kind+'-primary',name:'合成'+kind+'主模型',providerId:'be-primary'},{id:'be-'+kind+'-secondary',model:'be-'+kind+'-secondary',name:'合成'+kind+'备模型',providerId:'be-secondary'}],capabilityCatalogVersion:1,taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return;}
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
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
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/api/models?type=image','/api/models?type=chat','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}const beforeDrain={pending:s.pending.size,failed:s.failed.size};try{await nativeRequestsFinished(s);console.log('BE_PRE_UNMOUNT_DRAIN',JSON.stringify({beforeDrain,afterDrain:{pending:s.pending.size,failed:s.failed.size},notHistoricalTrace:true}));}catch(drain){primary=primary?new AggregateError([primary,drain],'BE_SCENARIO_AND_PRE_UNMOUNT_DRAIN'):drain;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}

interface BEEntry {theme:Theme;width:number;height:number}
const MATRIX=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
const EMPTY_COPY:Record<string,string>={'效果图':'设置参数后点击"生成展陈方案"','多角度':'已选 2 个视角','方案拆解':'尚无真实构件拆解结果。请选择分析模型后执行 AI 拆解。','尺寸标注':'生成效果图后自动标注各部件尺寸','材质工艺':'本次分析未返回材质与工艺信息。','平面拆解图':'本次分析未返回平面分区信息。','物料清单BOM':'本次分析未返回 BOM，暂不可导出清单。'};
let captureIndex=0;
function panel(s:Session):Locator{return s.page.locator('[data-popup]').filter({has:s.page.locator('[data-panel-header]').getByText('3D 展陈系统 Pro',{exact:true})});}
async function click(s:Session,b:Locator):Promise<void>{await reveal(s,b);const r=await b.boundingBox();if(!r)throw Error('BE_RECT');expect(await b.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native center hit').toBe(true);await s.page.mouse.click(r.x+r.width/2,r.y+r.height/2);await settle(s.page);}
async function reveal(s:Session,b:Locator):Promise<void>{for(let i=0;i<20;i++){const step=await b.evaluate(e=>{const r=e.getBoundingClientRect(),parents:HTMLElement[]=[];for(let p=e.parentElement;p;p=p.parentElement)parents.push(p);for(const p of parents.reverse()){const css=getComputedStyle(p),q=p.getBoundingClientRect(),top=Math.max(0,q.top+p.clientTop),bottom=Math.min(innerHeight,q.top+p.clientTop+p.clientHeight),left=Math.max(0,q.left+p.clientLeft),right=Math.min(innerWidth,q.left+p.clientLeft+p.clientWidth);let dx=0,dy=0;if(/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight){if(r.height<=bottom-top){if(r.top<top-.5)dy=r.top-top-3;else if(r.bottom>bottom+.5)dy=r.bottom-bottom+3;}else if(r.y+r.height/2<top+24||r.y+r.height/2>bottom-24)dy=r.y+r.height/2-(top+bottom)/2;}if(/auto|scroll/.test(css.overflowX)&&p.scrollWidth>p.clientWidth){if(r.left<left-.5)dx=r.left-left-3;else if(r.right>right+.5)dx=r.right-right+3;}if((dx||dy)&&bottom>top&&right>left)return {x:right-5,y:(top+bottom)/2,dx,dy};}return null;});if(!step)return;await s.page.mouse.move(step.x,step.y);await s.page.mouse.wheel(step.dx,step.dy);await settle(s.page);}throw Error('BE_BOUNDED_NATIVE_REVEAL');}
async function audit(s:Session,b:Locator,kind='control'):Promise<void>{await reveal(s,b);const v=await b.evaluate(e=>{const r=e.getBoundingClientRect(),css=getComputedStyle(e),faults:string[]=[];const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const g of range.getClientRects())if(g.left<r.left-.5||g.right>r.right+.5||g.top<r.top-.5||g.bottom>r.bottom+.5)faults.push('glyph-clipped');}return {tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,90)||e.getAttribute('placeholder'),width:r.width,height:r.height,font:Number.parseFloat(css.fontSize),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:[[r.x+r.width/2,r.y+r.height/2],[r.left+8,r.y+r.height/2],[r.right-8,r.y+r.height/2],[r.x+r.width/2,r.top+8],[r.x+r.width/2,r.bottom-8]].every(([x,y])=>e.contains(document.elementFromPoint(x,y))),faults};});console.log('BE_CONTROL',JSON.stringify({kind,...v}));expect.soft(v.width,v.name+' target width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' target height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' visible five-point target').toBe(true);expect.soft(v.faults,v.name+' complete glyphs').toEqual([]);if(['INPUT','SELECT','TEXTAREA'].includes(v.tag))expect.soft(v.font,v.name+' avoids mobile input zoom').toBeGreaterThanOrEqual(16);}
async function capture(s:Session,e:BEEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/display-entry-be-native-20261019',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,`${e.theme}-${e.width}x${e.height}-${++captureIndex}-${label}.png`);await s.page.screenshot({path:file});console.log('BE_CAPTURE',JSON.stringify({path:file,label,physicalAndroid:false,coze:false}));}
async function check(e:BEEntry,run:(s:Session)=>Promise<void>):Promise<void>{await withSession(e.theme,e.width,e.height,{},async s=>{try{await click(s,s.page.locator('[data-mobile-canvas-toolbar]').getByRole('button',{name:'全部工具',exact:true}));await click(s,s.page.getByRole('dialog',{name:'全部工具',exact:true}).getByRole('button',{name:'展陈Pro',exact:true}));await panel(s).waitFor();await nativeRequestsFinished(s);await settle(s.page);expect(await panel(s).count()).toBe(1);await run(s);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.images)).toEqual([]);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.view)).toEqual({offsetX:0,offsetY:0,zoom:1});await capture(s,e,'end');}catch(error){await capture(s,e,'failure');throw error;}});}
function imageSelect(s:Session):Locator{return panel(s).locator('label').filter({hasText:/^图像模型$/}).locator('xpath=..').locator('select');}
function chatSelect(s:Session):Locator{return panel(s).locator('label').filter({hasText:/^LLM模型$/}).locator('xpath=..').locator('select');}
for(const e of MATRIX){const tag=`BE ${e.theme} ${e.width}x${e.height}`;
 it(tag+' real parent entry has readable44px parameters16px inputs and keeps drafts/models through minimize',async()=>{await check(e,async s=>{const p=panel(s),controls=p.locator('button:visible,input:visible,select:visible,textarea:visible'),count=await controls.count();expect(count).toBeGreaterThan(40);for(let i=0;i<count;i++)await audit(s,controls.nth(i));const brand=p.getByPlaceholder('如：NIKE、星巴克、华为',{exact:true});await reveal(s,brand);await brand.fill('BE合成品牌草稿');await reveal(s,imageSelect(s));await imageSelect(s).selectOption('be-secondary::be-image-secondary');await reveal(s,chatSelect(s));await chatSelect(s).selectOption('be-secondary::be-chat-secondary');expect(await imageSelect(s).locator('optgroup[label="合成供应商乙"]').count()).toBe(1);expect(await chatSelect(s).locator('optgroup[label="合成供应商乙"]').count()).toBe(1);await click(s,p.getByRole('button',{name:'最小化 3D 展陈系统',exact:true}));await click(s,p.getByRole('button',{name:'展开 3D 展陈系统',exact:true}));expect(await brand.inputValue()).toBe('BE合成品牌草稿');expect(await imageSelect(s).inputValue()).toBe('be-secondary::be-image-secondary');expect(await chatSelect(s).inputValue()).toBe('be-secondary::be-chat-secondary');});},25000);
 it(tag+' project tabs and help are reachable and close without losing current workspace',async()=>{await check(e,async s=>{const p=panel(s);await click(s,p.getByRole('button',{name:'项目栏',exact:true}));const aside=p.locator('aside');for(const [name,text]of [['项目','暂无项目'],['模板','模板库即将上线'],['预设','场景预设即将上线']]){const tab=aside.getByRole('button',{name,exact:true});await audit(s,tab);await click(s,tab);expect(await aside.getByText(text,{exact:true}).count()).toBe(1);}await audit(s,aside.getByRole('button',{name:'+ 新建项目',exact:true}),'existing-unimplemented-placeholder-not-invoked');await click(s,aside.getByRole('button',{name:'收起项目栏',exact:true}));const help=p.getByRole('button',{name:'说明',exact:true});await audit(s,help);await click(s,help);const heading=p.getByRole('heading',{name:'3D 展陈系统 Pro — 使用说明',exact:true});await heading.waitFor();const close=heading.locator('xpath=..').getByRole('button');await audit(s,close);expect.soft(await close.getAttribute('aria-label'),'help close has accessible name').toBeTruthy();await click(s,close);expect(await heading.count()).toBe(0);expect(await p.getByRole('heading',{name:'3D 展陈工作台',exact:true}).count()).toBe(1);});},25000);
 it(tag+' preview secondary tabs and venue prerequisite remain usable without generating',async()=>{await check(e,async s=>{const p=panel(s),main=p.locator('main');for(const name of ['效果图','多角度','方案拆解','尺寸标注','材质工艺','平面拆解图','物料清单BOM']){const tabs=main.locator('section').filter({has:s.page.getByRole('button',{name:'物料清单BOM',exact:true})});const tab=tabs.getByRole('button',{name,exact:true});await audit(s,tab);await click(s,tab);const content=tabs.getByText(EMPTY_COPY[name],{exact:true});expect(await content.count(),'matching tab content '+name).toBe(1);await reveal(s,content);expect(await content.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}),'tab content visible '+name).toBe(true);const r=await tab.boundingBox();expect(r).not.toBeNull();}const venue=p.getByRole('button',{name:'活动现场',exact:true});await audit(s,venue);await click(s,venue);expect(await p.getByRole('heading',{name:'活动现场设计师',exact:true}).count()).toBe(1);for(const step of ['1','2','3','4'])await audit(s,p.getByRole('button',{name:step,exact:true}),'venue-step');const upload=p.getByRole('button',{name:/点击上传场馆照片/});await audit(s,upload,'venue-upload');expect(await upload.count()).toBe(1);expect(await p.getByText('请先上传场馆照片',{exact:true}).count()).toBe(1);await capture(s,e,'venue-prerequisite');await click(s,p.getByRole('button',{name:'展陈设计',exact:true}));expect(await p.getByRole('heading',{name:'3D 展陈工作台',exact:true}).count()).toBe(1);});},25000);
}

for(const e of MATRIX)it('BE '+e.theme+' '+e.width+'x'+e.height+' local synthetic asset has readable label and a visible separate removal target',async()=>{await check(e,async s=>{
 const p=panel(s),upload=p.getByRole('button',{name:'主视觉KV',exact:true});await reveal(s,upload);expect.soft(await upload.locator('span').last().evaluate(el=>Number.parseFloat(getComputedStyle(el).fontSize)),'asset literal label font').toBeGreaterThanOrEqual(12);
 const choosing=s.page.waitForEvent('filechooser',{timeout:1500});const [chooser]=await Promise.all([choosing,click(s,upload)]);await chooser.setFiles({name:'be-synthetic-reference.png',mimeType:'image/png',buffer:s.png});const image=p.locator('img[src^="blob:"]');await image.waitFor();expect(await image.count()).toBe(1);const asset=image.locator('xpath=../..'),remove=asset.getByRole('button');expect.soft(await remove.evaluate(el=>getComputedStyle(el).opacity),'removal visible without hover').toBe('1');expect.soft(await remove.getAttribute('aria-label'),'removal named').toBe('移除素材 be-synthetic-reference.png');
 await reveal(s,remove);const geometry=await remove.evaluate(el=>{const b=el.getBoundingClientRect(),parent=el.parentElement!.getBoundingClientRect(),img=el.parentElement!.querySelector('img')!.getBoundingClientRect();return {width:b.width,height:b.height,notOverImage:b.top>=img.bottom-.5,insideAsset:b.left>=parent.left&&b.right<=parent.right&&b.top>=parent.top&&b.bottom<=parent.bottom};});console.log('BE_LOCAL_ASSET',JSON.stringify({theme:e.theme,viewportWidth:e.width,viewportHeight:e.height,...geometry,localOnly:true}));expect.soft(geometry.notOverImage,'delete target is not over picture').toBe(true);expect.soft(geometry.insideAsset,'whole removal target fits asset').toBe(true);await audit(s,remove,'synthetic-local-removal');await capture(s,e,'local-asset');await click(s,remove);expect(await p.locator('img[src^="blob:"]').count(),'original local removal handler runs').toBe(0);
});},25000);


