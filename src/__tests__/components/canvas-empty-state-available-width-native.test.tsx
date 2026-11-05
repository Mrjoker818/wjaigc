// @vitest-environment node
// Real InfiniteCanvas and shipped CSS. Public props only; no paid/business I/O.
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
const GT_LIMITS:Record<string,number>={'/api/user-data/sync':2,'/api/models?type=all':1,'/api/models?type=image':4,'/api/models?type=chat':4,'/api/models?type=vlm':3,'/api/models?type=video':3,'/api/announcement':1,'/api/user-data/sync?key=projects':1,'/api/user-data/sync?key=chat_agents':3,'/api/user-data/sync?key=chat_sessions':3,'/api/skills?surface=canvas':3};
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CanvasWorkspace} from '@/components/canvas-workspace';
import {taskEventsClient} from '@/lib/task-events-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('GT_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();
const state={mounts:0,disposed:false,scopeChecks:0,images:[],groups:[],actions:[] as string[],view:null,events:[] as Array<{type:string;target:string}>};
const observe=(event:Event)=>{const el=event.target as Element;state.events.push({type:event.type,target:el?.closest?.('button')?.getAttribute('aria-label')||el?.closest?.('button')?.textContent?.trim()||el?.tagName||'unknown'});};
const user={id:'omp-mobile-user',name:'GI隔离用户',username:'GI隔离用户',role:'user' as const,apiPermissions:{image:true,chat:true,threeD:true,imageEdit:true,vectorize:true,vlm:true,layer:true,video:true,upscaler:true,removebg:true,audio:true},status:'active' as const,createdAt:1,updatedAt:1};
Object.assign(window,{canvasUi:{state,png,mount(){if(state.mounts||state.disposed)throw Error('GT_SINGLE_MOUNT');state.mounts++;for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,observe,true);root.render(<CanvasWorkspace initialUser={user} onLoggedOut={()=>state.actions.push('logout')}/>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();for(const type of ['pointerdown','pointerup','click'])document.removeEventListener(type,observe,true);}}});

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
  const result = await build({ write: false, outfile: 'gt-workspace-memory.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022',
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
  if(result.outputFiles.length!==2||scripts.length!==1||styles.length!==1||!styles[0].text.trim())throw Error('GT_EXACT_MEMORY_JS_AND_CSS');
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
    context.on('requestfailed', request => { s.pending.delete(request); s.failed.add(request); for (const notify of s.nativeWaiters) notify(); });
    page.on('pageerror', error => s.errors.push(String(error)));
    page.on('dialog', dialog => { s.errors.push('CANVAS_UI_FIXTURE_UNEXPECTED_DIALOG'); void dialog.dismiss().catch(error => s.errors.push(String(error))); });
    await context.routeWebSocket('**/*', socket => { s.errors.push('CANVAS_UI_FIXTURE_UNKNOWN_WS'); socket.close({ code: 1008, reason: 'Offline fixture forbids WebSockets' }); });
    await context.route('**/*', async route => {
      const operation = (async (): Promise<void> => {
        const request = route.request(), url = new URL(request.url()), headers = request.headers();
        if(request.method()==='POST'){
          const actorId=await page.evaluate(()=>localStorage.getItem('unbounded_ai_current_user'));
          if(!acceptsEmptyOwnedProjectsSync({url:request.url(),method:request.method(),headers,body:request.postData(),actorId,revision:s.projectRevision}))throw Error('GT_STRICT_EMPTY_PROJECT_SYNC_REJECTED');
          const key='/api/user-data/sync',count=(s.counts.get(key)??0)+1;s.counts.set(key,count);
          if(count>GT_LIMITS[key])throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT '+key);
          s.projectRevision++;
          await route.fulfill({json:{success:true,projectIdMap:{},projectRevision:s.projectRevision,deletedCanvasPlacements:[]}});return;
        }
        if (url.origin !== ORIGIN || url.username || url.password || request.method() !== 'GET' || request.postData() !== null
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > (GT_LIMITS[key]??(['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1))) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
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
        if (key === '/api/task-events') { await route.fulfill({ status:204,body:'' });return; }
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
  const allowed=['/?loginMode=canvas',...Object.keys(GT_LIMITS),'/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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
async function tap(s:Session,el:Locator):Promise<void>{await el.tap();await nativeRequestsFinished(s);await settle(s.page);}
async function surfaceTransform(s:Session):Promise<string>{return s.page.locator('[data-canvas-surface]').evaluate(el=>getComputedStyle(el).transform);}
async function touchDrag(s:Session,start:{x:number;y:number},dx:number,dy:number):Promise<void>{
 const client=await s.context.newCDPSession(s.page);let active=false,primary:unknown;const cleanup:unknown[]=[];
 try{await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:0,radiusX:5,radiusY:5,force:1}]});active=true;
  for(let step=1;step<=10;step++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+dx*step/10,y:start.y+dy*step/10,id:0,radiusX:5,radiusY:5,force:1}]});await settle(s.page);}
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;await settle(s.page);
 }catch(error){primary=error;}finally{if(active)try{await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch(error){cleanup.push(error);}try{await client.detach();}catch(error){cleanup.push(error);}}
 if(primary&&cleanup.length)throw new AggregateError([primary,...cleanup],'GT_TOUCH_AND_CLEANUP');if(primary)throw primary;if(cleanup.length)throw new AggregateError(cleanup,'GT_TOUCH_CLEANUP');
}
async function touchRouting(s:Session):Promise<void>{
 const content=s.page.locator('[data-canvas-empty-state] > div');
 const geometry=await content.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,top:el.scrollTop};});
 const before=await surfaceTransform(s);
 if(geometry.scrollHeight>geometry.clientHeight+1){
  await touchDrag(s,{x:geometry.x+geometry.width/2,y:geometry.y+geometry.height-20},0,-70);
  await expect.poll(()=>content.evaluate(el=>el.scrollTop),{timeout:1500}).toBeGreaterThan(geometry.top);
  expect(await surfaceTransform(s),'overflow touch scroll does not move canvas').toBe(before);
  console.log('GT_TOUCH_ROUTING',JSON.stringify({scroll:true,backgroundPan:false}));
 }else{
  const heading=await content.getByRole('heading',{name:'无限画布',exact:true}).boundingBox();if(!heading)throw Error('GT_HEADING_BOUNDS');
  const start={x:heading.x+heading.width/2,y:heading.y+heading.height/2};
  expect(await s.page.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('[data-canvas-viewport]')&&!document.elementFromPoint(p.x,p.y)?.closest('[data-toolbar]'),start),'nonoverflow text remains transparent to canvas').toBe(true);
  await touchDrag(s,start,32,0);await expect.poll(()=>surfaceTransform(s),{timeout:1500}).not.toBe(before);
  await touchDrag(s,{x:start.x+32,y:start.y},-32,0);
  await expect.poll(()=>surfaceTransform(s),{timeout:1500}).toBe(before);
  console.log('GT_TOUCH_ROUTING',JSON.stringify({scroll:false,backgroundPan:true}));
 }
}
async function visibleWelcome(s:Session,label:string):Promise<void>{
 const geometry=await s.page.locator('[data-canvas-empty-state] > div').evaluate(el=>{
  const r=el.getBoundingClientRect(),panel=document.querySelector('[data-workspace-right-panel]')!.getBoundingClientRect();
  const nav=document.querySelector('[data-toolbar="left-toolbar"]')!.firstElementChild!.getBoundingClientRect();
  const rect=(v:DOMRect)=>({left:v.left,right:v.right,top:v.top,bottom:v.bottom,width:v.width,height:v.height});
  const glyphs=Array.from(el.querySelectorAll('h2,p')).flatMap(node=>{const range=document.createRange();range.selectNodeContents(node);return Array.from(range.getClientRects()).map(rect);});
  return{body:rect(r),panel:rect(panel),nav:rect(nav),glyphs,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,viewport:{width:innerWidth,height:innerHeight}};
 });
 console.log('GT_WELCOME_GEOMETRY',JSON.stringify({label,...geometry}));
 expect(geometry.body.right,'welcome clears the actual right panel').toBeLessThanOrEqual(geometry.panel.left-8);
 expect(geometry.body.left,'welcome clears the actual left navigation').toBeGreaterThanOrEqual(geometry.nav.right+8);
 expect(geometry.body.top).toBeGreaterThanOrEqual(8);expect(geometry.body.bottom).toBeLessThanOrEqual(geometry.viewport.height-8);
 expect(geometry.clientWidth).toBeGreaterThan(0);expect(geometry.clientHeight).toBeGreaterThan(0);
 expect(geometry.scrollWidth,'welcome has no horizontal overflow').toBeLessThanOrEqual(geometry.clientWidth+1);
 for(const r of geometry.glyphs){expect(r.left,'complete text left edge').toBeGreaterThanOrEqual(geometry.body.left-1);expect(r.right,'complete text right edge').toBeLessThanOrEqual(geometry.body.right+1);}
}
async function revealAndTarget(s:Session,button:Locator):Promise<void>{
 const content=s.page.locator('[data-canvas-empty-state] > div');
 for(let attempt=0;attempt<4;attempt++){
  const b=await button.boundingBox(),c=await content.boundingBox();if(!b||!c)throw Error('GT_VISIBLE_ACTION_BOUNDS');
  if(b.y>=c.y&&b.y+b.height<=c.y+c.height)break;
  await s.page.mouse.move(c.x+c.width/2,c.y+c.height/2);await s.page.mouse.wheel(0,b.y<c.y?-160:160);await settle(s.page);
 }
 const g=await button.evaluate(el=>{const r=el.getBoundingClientRect(),c=el.closest('[data-canvas-empty-state]')!.firstElementChild!.getBoundingClientRect();
  return{width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,content:{left:c.left,right:c.right,top:c.top,bottom:c.bottom},hit:[[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4],[r.left+r.width/2,r.top+r.height/2]].every(([x,y])=>el.contains(document.elementFromPoint(x,y)))};});
 expect(g.width).toBeGreaterThanOrEqual(44);expect(g.height).toBeGreaterThanOrEqual(44);
 expect(g.left).toBeGreaterThanOrEqual(g.content.left);expect(g.right).toBeLessThanOrEqual(g.content.right);
 expect(g.top).toBeGreaterThanOrEqual(g.content.top);expect(g.bottom).toBeLessThanOrEqual(g.content.bottom);
 expect(g.hit,'all four inset corners and center reach actual action').toBe(true);
}
async function uploadOnce(s:Session,button:Locator):Promise<void>{
 let count=0;const countChooser=():void=>{count++;};s.page.on('filechooser',countChooser);
 const chooserPromise=s.page.waitForEvent('filechooser',{timeout:1500});
 try{const [,chooser]=await Promise.all([button.tap(),chooserPromise]);await chooser.setFiles([]);await nativeRequestsFinished(s);await settle(s.page);
  expect(count,'one native upload chooser only').toBe(1);expect(await chooser.element().evaluate(el=>(el as HTMLInputElement).files?.length)).toBe(0);
 }finally{s.page.off('filechooser',countChooser);}
}
async function capture(s:Session,e:{width:number;height:number},theme:Theme):Promise<void>{
 const dir=path.resolve('output/playwright/canvas-empty-gt-workspace-20261020',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.width+'x'+e.height+'-'+theme+'-end-or-failure.png');
 await s.page.screenshot({path:file});console.log('GT_CAPTURE',JSON.stringify({file,notCloudEdgeAndroidOrWholeMobileAcceptance:true}));
}
for(const e of cases)for(const theme of ['gold','mono'] as const)it('GT actual Workspace '+e.width+'x'+e.height+' '+theme+' empty welcome and real actions',async()=>{
 await withSession(theme,e.width,e.height,{touch:true},async s=>{try{
  const content=s.page.locator('[data-canvas-empty-state] > div'),panel=s.page.locator('[data-workspace-right-panel]');
  expect(await content.getByRole('heading',{name:'无限画布',exact:true}).isVisible()).toBe(true);
  await visibleWelcome(s,'initial');await touchRouting(s);const initialTransform=await surfaceTransform(s);
  const actions=content.getByRole('group',{name:'空画布快捷操作',exact:true});
  expect((await actions.getByRole('button').allTextContents()).map(text=>text.trim())).toEqual(['上传图片','使用说明']);
  const upload=actions.getByRole('button',{name:'上传图片',exact:true}),help=actions.getByRole('button',{name:'使用说明',exact:true});
  await revealAndTarget(s,upload);expect(await surfaceTransform(s)).toBe(initialTransform);await uploadOnce(s,upload);
  await revealAndTarget(s,help);expect(await surfaceTransform(s)).toBe(initialTransform);await tap(s,help);
  const dialog=s.page.getByRole('dialog',{name:'使用说明',exact:true});await dialog.waitFor({state:'visible'});
  await tap(s,dialog.getByRole('button',{name:'关闭画布帮助',exact:true}));await dialog.waitFor({state:'detached'});
  expect(await surfaceTransform(s),'welcome scrolling/upload/help must not pan or zoom canvas').toBe(initialTransform);
  if(e.width<768){
   // Explicit new covered-background contract, not a substitute for hit testing.
   await tap(s,panel.getByRole('button',{name:'展开面板',exact:true}));await expect.poll(()=>s.page.locator('[data-canvas-empty-state]').isVisible(),{timeout:1500}).toBe(false);
   await tap(s,panel.getByRole('button',{name:'收起面板',exact:true}));await content.waitFor({state:'visible'});await visibleWelcome(s,'restored-mobile');
  }else{
   await tap(s,panel.getByRole('button',{name:'收起面板',exact:true}));await visibleWelcome(s,'collapsed');
   await tap(s,panel.getByRole('button',{name:'展开面板',exact:true}));await visibleWelcome(s,'expanded-again');
  }
  const cache=await s.page.evaluate(()=>({actor:localStorage.getItem('unbounded_ai_current_user'),data:JSON.parse(localStorage.getItem('unbounded_ai_user_data')||'null')}));
  expect(cache.actor).toBe('omp-mobile-user');expect(cache.data.userData['omp-mobile-user'].projects).toEqual([]);
  expect(Object.keys(cache.data.userData).sort()).toEqual(['admin_mr_joker','omp-mobile-user']);
  expect(cache.data.userData.admin_mr_joker.projects.length,'default admin examples are not actor projects').toBeGreaterThan(0);
  expect(await s.page.locator('[data-canvas-image-id]').count()).toBe(0);expect(await s.page.evaluate(()=>new URL(location.href).searchParams.has('projectId'))).toBe(false);
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.actions)).toEqual([]);
  await nativeRequestsFinished(s);console.log('GT_PUBLIC_FLOW_BODY',JSON.stringify({...e,theme,bodyNotGate:true,notWholeC49OrMobileAccepted:true}));
 }finally{await capture(s,e,theme);}});
},25000);

for (const scenario of [
  { width: 320, height: 640, theme: 'gold' as const, close: 'button' as const },
  { width: 640, height: 320, theme: 'mono' as const, close: 'backdrop' as const },
]) it(`W19 guide ${scenario.width}x${scenario.height} ${scenario.theme} ${scenario.close} restores toolbar focus`, async () => {
  await withSession(scenario.theme, scenario.width, scenario.height, { touch: true }, async s => {
    const page = s.page;
    const toolbar = page.locator('[data-toolbar="left-toolbar"]');
    await page.getByTitle('展开工具栏', { exact: true }).click();
    const opener = toolbar.getByRole('button', { name: '使用说明', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '使用说明', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await nativeRequestsFinished(s);
    await settle(page);
    expect(await opener.evaluate(el => el.isConnected)).toBe(true);
    if (scenario.close === 'button') {
      await dialog.getByRole('button', { name: '关闭使用说明', exact: true }).click();
    } else {
      await page.mouse.click(1, 1);
    }
    await dialog.waitFor({ state: 'detached' });
    await settle(page);
    expect(await opener.evaluate(el => el.isConnected && document.activeElement === el)).toBe(true);
    await page.mouse.click(1, 1);
    await expect.poll(() => opener.count()).toBe(0);
  });
}, 25000);

for (const method of ['touch', 'escape'] as const) it(`W19 guide ${method} closes without losing toolbar focus`, async () => {
  await withSession('gold', 390, 844, { touch: true }, async s => {
    const page = s.page;
    const toolbar = page.locator('[data-toolbar="left-toolbar"]');
    await page.getByTitle('展开工具栏', { exact: true }).click();
    const opener = toolbar.getByRole('button', { name: '使用说明', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '使用说明', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await nativeRequestsFinished(s);
    await settle(page);
    if (method === 'touch') await dialog.getByRole('button', { name: '关闭使用说明', exact: true }).tap();
    else await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await settle(page);
    expect(await opener.evaluate(el => el.isConnected && document.activeElement === el)).toBe(true);
  });
}, 25000);
