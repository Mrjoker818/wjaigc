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
import {acceptsEmptyOwnedProjectsSync} from '@/__tests__/helpers/canvas-toolbar-empty-sync-contract.mjs';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;collapsed?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];groups:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>}}}
interface Session {projectRevision:number;context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number}
const ORIGIN='https://canvas-shell-mobile.invalid';
const GQ_LIMITS:Record<string,number>={'/api/user-data/sync':2,'/api/models?type=all':1,'/api/models?type=image':4,'/api/models?type=chat':4,'/api/models?type=vlm':3,'/api/models?type=video':3,'/api/announcement':1,'/api/user-data/sync?key=projects':1,'/api/user-data/sync?key=chat_agents':3,'/api/user-data/sync?key=chat_sessions':3,'/api/skills?surface=canvas':3};
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CanvasWorkspace} from '@/components/canvas-workspace';
import {taskEventsClient} from '@/lib/task-events-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('GQ_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const state={mounts:0,disposed:false,scopeChecks:0,images:[],groups:[],actions:[] as string[],view:null,events:[] as Array<{type:string;target:string}>};
const observe=(event:Event)=>{const el=event.target as Element;state.events.push({type:event.type,target:el?.closest?.('button')?.getAttribute('aria-label')||el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const user={id:'omp-mobile-user',name:'GI隔离用户',username:'GI隔离用户',role:'user' as const,apiPermissions:{image:true,chat:true,threeD:true,imageEdit:true,vectorize:true,vlm:true,layer:true,video:true,upscaler:true,removebg:true,audio:true},status:'active' as const,createdAt:1,updatedAt:1};
Object.assign(window,{canvasUi:{state,png,mount(){if(state.mounts||state.disposed)throw Error('GQ_SINGLE_MOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,observe,true);root.render(<CanvasWorkspace initialUser={user} onLoggedOut={()=>state.actions.push('logout')}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','click'])document.removeEventListener(type,observe,true);}}});

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
  const result = await build({ write: false, outfile: 'gq-workspace-memory.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
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
  const scripts=result.outputFiles.filter(f=>f.path.endsWith('.js')),styles=result.outputFiles.filter(f=>f.path.endsWith('.css'));
  if(result.outputFiles.length!==2||scripts.length!==1||styles.length!==1||!styles[0].text.trim())throw Error('GQ_EXACT_MEMORY_JS_AND_CSS');
  bundle=scripts[0].text;
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
  css = compiler.build(new Scanner({}).scanFiles(sources))+'\n'+styles[0].text;
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
    const s: Session = {projectRevision:0, context, page, options, errors: [], counts: new Map(), handlers: new Set(), mounted: false,
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
        if(request.method()==='POST'){
          const actorId=await page.evaluate(()=>localStorage.getItem('unbounded_ai_current_user'));
          if(!acceptsEmptyOwnedProjectsSync({url:request.url(),method:request.method(),headers,body:request.postData(),actorId,revision:s.projectRevision}))throw Error('GQ_STRICT_EMPTY_PROJECT_SYNC_REJECTED');
          const key='/api/user-data/sync',count=(s.counts.get(key)??0)+1;s.counts.set(key,count);
          if(count>GQ_LIMITS[key])throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT '+key);
          s.projectRevision++;
          await route.fulfill({json:{success:true,projectIdMap:{},projectRevision:s.projectRevision,deletedCanvasPlacements:[]}});return;
        }
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > (GQ_LIMITS[key]??(['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1))) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/?loginMode=canvas' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/announcement'){await route.fulfill({json:{success:true,announcement:{enabled:false,text:'',type:'info'}}});return;}
        if(key==='/api/user-data/sync?key=projects'){await route.fulfill({json:{success:true,value:[],projectRevision:s.projectRevision,deletedCanvasPlacements:[]}});return;}
        if(key==='/api/user-data/sync?key=chat_agents'||key==='/api/user-data/sync?key=chat_sessions'){await route.fulfill({json:{success:true,value:[]}});return;}
        if(key==='/api/skills?surface=canvas'){await route.fulfill({json:{success:true,skills:[]}});return;}
        if(['/api/models?type=all','/api/models?type=image','/api/models?type=chat','/api/models?type=vlm','/api/models?type=video'].includes(key)){await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return;}
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',name:'GI隔离用户',username:'GI隔离用户',role:'user',apiPermissions:{image:true,chat:true,threeD:true,imageEdit:true,vectorize:true,vlm:true,layer:true,video:true,upscaler:true,removebg:true,audio:true},status:'active',createdAt:1,updatedAt:1} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ status:503,json:{success:false,error:'OFFLINE_FIXTURE_EVENTS_UNAVAILABLE'} });return; }
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',apiPermissions:{image:true,chat:true,threeD:true,imageEdit:true,vectorize:true,vlm:true,layer:true,video:true,upscaler:true,removebg:true,audio:true},status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('wujie_selected_model',JSON.stringify({model:'bx-provider::bx-image',providerId:'bx-provider'}));localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
    await page.goto(ORIGIN+'/?loginMode=canvas'); await page.addScriptTag({ content: bundle });
    console.log('BB_FETCH_RECEIVER_DIAG',JSON.stringify(await page.evaluate(async()=>{const errors:string[]=[];const holder={fetcher:window.fetch};try{await holder.fetcher('http://[');}catch(error){errors.push(String(error));}try{await window.fetch('http://[');}catch(error){errors.push(String(error));}return errors;})));
    s.png=Buffer.from((await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.png)).split(',')[1],'base64');
    await page.evaluate(v => (window as unknown as FixtureWindow).canvasUi.mount(v.theme,v.options), {theme,options}); s.mounted = true;
    await page.locator('[data-canvas-viewport]').waitFor();
    await nativeRequestsFinished(s); await settle(page);
    await page.locator('[data-workspace-right-panel]').waitFor({state:'visible'});
    expect(await page.evaluate(()=>new URL(location.href).searchParams.get('loginMode'))).toBe('canvas');
    if(theme==='mono'){await page.getByTitle('切换黑白模式',{exact:true}).tap();await page.getByTitle('切换彩色模式',{exact:true}).waitFor();await nativeRequestsFinished(s);await settle(page);}
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
  const allowed=['/?loginMode=canvas',...Object.keys(GQ_LIMITS),'/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
  const keys=[...s.counts.keys()];
  if(s.options.requireMissing || s.counts.get('/?loginMode=canvas')!==1 || keys.some(k=>!allowed.includes(k)&&!(expectedRefusal==='http'&&k==='/unexpected'))){
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
















const cases=[{width:320,height:568},{width:375,height:812},{width:768,height:1024},{width:844,height:390},{width:1040,height:720}];
async function tap(s:Session,el:Locator):Promise<void>{await el.scrollIntoViewIfNeeded();await el.tap();await nativeRequestsFinished(s);await settle(s.page);}
async function panelWidth(panel:Locator,width:number):Promise<void>{await expect.poll(async()=>(await panel.boundingBox())?.width,{timeout:1500}).toBeCloseTo(width,1);}
async function sidebarTarget(s:Session,panel:Locator,expanded:boolean):Promise<void>{
 const button=panel.getByRole('button',{name:expanded?'收起面板':'展开面板',exact:true});
 const state=await button.evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,center:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),leftEdge:el.contains(document.elementFromPoint(r.x+4,r.y+r.height/2)),rightEdge:el.contains(document.elementFromPoint(r.right-4,r.y+r.height/2))};});
 console.log('GQ_SIDEBAR_TARGET',JSON.stringify({expanded,...state}));
 expect(state.width,'sidebar rail must expose44px usable touch width').toBeGreaterThanOrEqual(44);expect(state.height).toBeGreaterThanOrEqual(44);
 expect(state.center&&state.leftEdge&&state.rightEdge,'rail center and both inset edge points belong to actual button').toBe(true);
 expect(await button.getAttribute('aria-expanded')).toBe(String(expanded));
}
async function toolbarClearance(s:Session,label:string,mapTitle:'打开小地图'|'关闭小地图'|null):Promise<void>{
 const measurements=await s.page.locator('[data-toolbar="bottom-toolbar"]').evaluate(el=>{
  const toolbar=el.getBoundingClientRect(),panel=document.querySelector('[data-workspace-right-panel]')!.getBoundingClientRect();
  const rect=(r:DOMRect)=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
  const buttons=Array.from(el.querySelectorAll(':scope > button, :scope > [data-canvas-toolbar-primary] > button, :scope > [data-canvas-toolbar-auxiliary] > button')).map(button=>{const b=button.getBoundingClientRect();return{label:button.getAttribute('title')||button.getAttribute('aria-label'),rect:rect(b),ownsCenter:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});
  return{toolbar:rect(toolbar),panel:rect(panel),buttons};
 });
 console.log('GQ_TOOLBAR_GEOMETRY',JSON.stringify({label,...measurements}));
 expect(measurements.toolbar.x,'toolbar left gutter').toBeGreaterThanOrEqual(8);
 expect(measurements.toolbar.right,'toolbar stays left of actual sidebar').toBeLessThanOrEqual(measurements.panel.x-8);
 const labels=measurements.buttons.map(b=>b.label);
 const gridLabels=['网格: 点阵','网格: 线条','网格: 空白'],connectionLabels=['隐藏连线','显示连线'];
 expect(labels.filter(v=>gridLabels.includes(v||''))).toHaveLength(1);
 expect(labels.filter(v=>connectionLabels.includes(v||''))).toHaveLength(1);
 expect(labels.filter(v=>!gridLabels.includes(v||'')&&!connectionLabels.includes(v||'')).sort()).toEqual(['选择工具','抓手工具','图片上传','图像生成器','全部工具','缩小画布','放大画布','重置视图','命令面板 (Ctrl+K / Cmd+K)','打开图层','版本历史','AI 引擎设置 (放大/去背景/SVG/分层)',...(mapTitle?[mapTitle]:[])].sort());
 for(const b of measurements.buttons){expect(b.rect.width,b.label+' width').toBeGreaterThanOrEqual(44);expect(b.rect.height,b.label+' height').toBeGreaterThanOrEqual(44);expect(b.ownsCenter,b.label+' center belongs to actual button').toBe(true);}
}
async function mapClearance(s:Session):Promise<void>{
 const map=s.page.getByRole('region',{name:'画布小地图',exact:true});
 const geometry=await map.evaluate(el=>{const r=el.getBoundingClientRect(),p=document.querySelector('[data-workspace-right-panel]')!.getBoundingClientRect(),t=document.querySelector('[data-toolbar="bottom-toolbar"]')!.getBoundingClientRect();return{right:r.right,panelLeft:p.left,toolbarTop:t.top,mapBottom:r.bottom,top:r.top};});
 expect(geometry.right).toBeLessThanOrEqual(geometry.panelLeft-11);expect(geometry.mapBottom).toBeLessThanOrEqual(geometry.toolbarTop-7);expect(geometry.top).toBeGreaterThanOrEqual(0);
 const plot=map.getByTestId('canvas-minimap-map'),b=await plot.boundingBox();if(!b)throw Error('GQ_MAP_BOUNDS');
 for(const point of [{x:b.x+8,y:b.y+8},{x:b.x+168,y:b.y+116},{x:b.x+8,y:b.y+116}])expect(await plot.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),point)).toBe(true);
}
async function capture(s:Session,e:{width:number;height:number},theme:Theme,label:string):Promise<void>{
 const dir=path.resolve('output/playwright/canvas-minimap-gq-workspace-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,`${e.width}x${e.height}-${theme}-${label}.png`);await s.page.screenshot({path:file});console.log('GQ_CAPTURE',JSON.stringify({file,notCloudEdgeAndroidOrWholeMobileAcceptance:true}));
}
for(const e of cases)for(const theme of ['gold','mono'] as const)it(`GQ actual Workspace ${e.width}x${e.height} ${theme} shared sidebar rail and toolbar`,async()=>{
 await withSession(theme,e.width,e.height,{touch:true},async s=>{try{
  const panel=s.page.locator('[data-workspace-right-panel]');await sidebarTarget(s,panel,e.width>=768);await panelWidth(panel,e.width<768?44:480);
  expect(await s.page.locator('[data-canvas-image-id]').count()).toBe(0);
  expect(await s.page.evaluate(()=>new URL(location.href).searchParams.has('projectId'))).toBe(false);
  if(e.width<768){
   await tap(s,panel.getByRole('button',{name:'展开面板',exact:true}));await panelWidth(panel,e.width);await sidebarTarget(s,panel,true);
   expect(await panel.getByText('图像生成',{exact:true}).isVisible()).toBe(true);
   await tap(s,panel.getByRole('button',{name:'收起面板',exact:true}));await panelWidth(panel,44);await sidebarTarget(s,panel,false);
   expect(await s.page.locator('[data-toolbar="bottom-toolbar"]').isVisible()).toBe(false);
   const mobile=s.page.locator('[data-mobile-canvas-toolbar]');expect(await mobile.isVisible()).toBe(true);
   await tap(s,mobile.getByRole('button',{name:'全部工具',exact:true}));const drawer=s.page.getByRole('dialog',{name:'全部工具',exact:true});await drawer.waitFor({state:'visible'});
   await tap(s,drawer.getByRole('button',{name:'关闭全部工具',exact:true}));await drawer.waitFor({state:'detached'});
  }else{
   await toolbarClearance(s,'initial',e.width===1040?'打开小地图':null);
   if(e.width===1040){await tap(s,s.page.locator('[data-toolbar="bottom-toolbar"]').getByTitle('打开小地图',{exact:true}));await s.page.getByRole('region',{name:'画布小地图',exact:true}).waitFor();await mapClearance(s);}
   await tap(s,panel.getByRole('button',{name:'收起面板',exact:true}));await panelWidth(panel,44);await sidebarTarget(s,panel,false);await toolbarClearance(s,'collapsed',e.width===1040?'关闭小地图':'打开小地图');
   if(e.width!==1040){await tap(s,s.page.locator('[data-toolbar="bottom-toolbar"]').getByTitle('打开小地图',{exact:true}));await s.page.getByRole('region',{name:'画布小地图',exact:true}).waitFor();}
   await mapClearance(s);
   await tap(s,s.page.getByRole('region',{name:'画布小地图',exact:true}).getByRole('button',{name:'关闭小地图',exact:true}));
   await tap(s,panel.getByRole('button',{name:'展开面板',exact:true}));await panelWidth(panel,480);await sidebarTarget(s,panel,true);await toolbarClearance(s,'expanded-again',e.width===1040?'打开小地图':null);
   await tap(s,s.page.locator('[data-toolbar="bottom-toolbar"]').getByRole('button',{name:'全部工具',exact:true}));
   const drawer=s.page.locator('[data-bottom-toolbar-drawer]');await drawer.waitFor({state:'visible'});
   expect(await drawer.locator('section').count()).toBeGreaterThanOrEqual(3);
   await tap(s,drawer.getByRole('button',{name:'关闭工具抽屉',exact:true}));await drawer.waitFor({state:'hidden'});
  }
  const cache=await s.page.evaluate(()=>({actor:localStorage.getItem('unbounded_ai_current_user'),data:JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null')}));
  expect(cache.actor).toBe('omp-mobile-user');expect(cache.data.userData['omp-mobile-user'].projects).toEqual([]);
  expect(Object.keys(cache.data.userData).sort()).toEqual(['admin_mr_joker','omp-mobile-user']);
  expect(cache.data.userData.admin_mr_joker.projects.length,'default admin examples are not the actor projects').toBeGreaterThan(0);
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.actions)).toEqual([]);
  await nativeRequestsFinished(s);
  console.log('GQ_PUBLIC_FLOW_BODY',JSON.stringify({...e,theme,bodyNotGate:true,notWholeC49OrMobileAccepted:true}));
 }finally{await capture(s,e,theme,'end-or-failure');}});
},25000);
