// @vitest-environment node
// Real VideoPanel/MotionBrushCanvas and shipped CSS. Public props only; no paid/business I/O.
import { readFile, mkdir, mkdtemp, open, unlink, rmdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { validateBIUpload, validateBIActivity } from '../helpers/video-character-bi-upload-contract';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;directMotion?:boolean;captureGeneration?:boolean;collectUploadError?:boolean;uploadMode?:'accept'|'reject'|'oversize'}
interface FixtureWindow extends Window {canvasUi:{png:string;blue:string;updateImage(url:string):void;exportMotion():unknown;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>;uploadErrors:string[];generations:Array<{cameraControl?:{type:string;intensity:number};motionStrength?:number;resolution?:string;negativePrompt?:string;seed?:number;characterReferences?:string[];firstFrameUrl?:string;motionBrush?:{maskDataUrl:string;trajectories:unknown[]}}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;bluePng:Buffer;uploadStatuses:number[];releaseRecovery:()=>void;recoveryCalls:number}
const ORIGIN='https://canvas-shell-mobile.invalid';
const THEMES:readonly Theme[]=['gold','mono'];
const HELP_FILES=['canvas-overview.jpeg','erase-tool.jpeg','mask-tool.jpeg','remove-bg.jpeg','upscale.jpeg','lang-edit.jpeg','svg-trace.jpeg','extend.jpeg','oh-my-prompt.jpeg'];
const ENTRY=String.raw`import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import VideoPanel from '@/components/video-generation-panel';
import MotionBrushCanvas,{type MotionBrushCanvasHandle} from '@/components/motion-brush-canvas';
import {taskEventsClient} from '@/lib/task-events-client';
import {OperationAuditClient} from '@/components/operation-audit-client';
const root=createRoot(document.getElementById('fixture-root')!);
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('BI_NATIVE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();picture.height=128;ctx.fillStyle='#416b9c';ctx.fillRect(0,0,64,128);const blue=picture.toDataURL();
const state={mounts:0,disposed:false,scopeChecks:0,images:[],actions:[] as string[],view:null,events:[],closes:0,exports:[] as unknown[],generations:[] as unknown[],uploadErrors:[] as string[]};
let updateImage:(url:string)=>void=()=>{throw Error('BI_NOT_MOUNTED');};let exportMotion:()=>unknown=()=>null;
function Entry({theme,directMotion,captureGeneration,collectUploadError}:{theme:'gold'|'mono';directMotion:boolean;captureGeneration:boolean;collectUploadError:boolean}):React.ReactElement{const [url,setUrl]=useState(png),[closed,setClosed]=useState(false);const api=useRef<MotionBrushCanvasHandle>(null);updateImage=setUrl;exportMotion=()=>api.current?.export()??null;const close=()=>{state.closes++;setClosed(true);};return <><OperationAuditClient/>{!closed&&(directMotion?<section aria-label="独立运动笔刷" style={{maxWidth:600,margin:8}}><MotionBrushCanvas ref={api} imageUrl={url} onExport={result=>state.exports.push(result)} onClose={close}/></section>:<VideoPanel floating selectedImageUrl={url} themeStyle={theme==='mono'?'monochrome':'gold'} onClose={close} onVideoGenerate={async params=>{if(!captureGeneration)throw Error('BI_UNEXPECTED_GENERATION');state.generations.push(params);return {};}} onError={message=>{if(!collectUploadError)throw Error('BI_UNEXPECTED_VIDEO_ERROR '+message);state.uploadErrors.push(message);}}/>)}</>;}
Object.assign(window,{canvasUi:{state,png,blue,mount(theme:'gold'|'mono',options:{directMotion?:boolean;captureGeneration?:boolean;collectUploadError?:boolean}){if(state.mounts||state.disposed)throw Error('BI_REMOUNT');state.mounts++;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} directMotion={options.directMotion===true} captureGeneration={options.captureGeneration===true} collectUploadError={options.collectUploadError===true}/>);},updateImage:(url:string)=>updateImage(url),exportMotion:()=>exportMotion(),unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();}}});`;

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
      pending: new Set(), completed: new Set(), failed: new Set(), refused: new Set(), responseStatus: new Map(), nativeWaiters: new Set(), png: Buffer.alloc(0),bluePng:Buffer.alloc(0),uploadStatuses:[],releaseRecovery,recoveryCalls:0 }; value = s; live.add(s);
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
        const keyPath=url.pathname+url.search,isUpload=request.method()==='POST'&&keyPath==='/api/save-image',isActivity=request.method()==='POST'&&keyPath==='/api/activity';
        if (url.origin !== ORIGIN || url.username || url.password || (!isUpload&&!isActivity&&(request.method() !== 'GET' || request.postData() !== null))
          || headers.authorization || headers.cookie || headers['x-api-key'] || headers['api-key'] || headers['idempotency-key']) throw Error('CANVAS_UI_FIXTURE_HTTP_BOUNDARY');
        const key = url.pathname + url.search, count = (s.counts.get(key) ?? 0) + 1; s.counts.set(key, count);
        if (count > ((key==='/api/save-image'||key==='/api/activity')?2:['/api/session','/api/auth/me','/api/task-events'].includes(key)?6:HELP_FILES.some(file=>key==='/api/help-image?file='+file)?3:1)) throw Error('CANVAS_UI_FIXTURE_HTTP_COUNT ' + key);
        if (key === '/' && request.isNavigationRequest()) {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="position:relative;width:100%;height:100%"></div></body></html>` }); return;
        }
        if(key==='/api/tasks/recover?projectId=canvas-ui-project'){if(headers['x-wujie-expected-actor-id']!=='omp-mobile-user'||headers['content-type']!=='application/json')throw Error('BB_RECOVERY_ACTOR_HEADERS');s.recoveryCalls++;await recoveryGate;await route.fulfill({json:{success:true,tasks:[]}});return;}
        if (key === '/api/session' || key === '/api/auth/me') { await route.fulfill({ json: { success:true,user:{id:'omp-mobile-user',username:'离线用户',role:'user'} } }); return; }
        if (key === '/api/task-events') { await route.fulfill({ contentType:'text/event-stream',body:'data: heartbeat\n\n' });return; }
        if(key==='/api/models?type=image'||key==='/api/models?type=chat'){const kind=key.endsWith('image')?'image':'chat';await route.fulfill({json:{success:true,providers:[{id:'be-primary',name:'合成供应商甲',isEnabled:true},{id:'be-secondary',name:'合成供应商乙',isEnabled:true}],models:[{id:'be-'+kind+'-primary',model:'be-'+kind+'-primary',name:'合成'+kind+'主模型',providerId:'be-primary'},{id:'be-'+kind+'-secondary',model:'be-'+kind+'-secondary',name:'合成'+kind+'备模型',providerId:'be-secondary'}],capabilityCatalogVersion:1,taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return;}
        if(key==='/api/models?type=video'){await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[{id:'bg-offline',name:'BI合成供应商',isEnabled:true}],models:[{id:'kling-v3-video-generation',name:'BI合成视频模型',providerId:'bg-offline',type:'video',isDefault:true}],taskModelCatalog:[{providerId:'bg-offline',modelId:'kling-v3-video-generation',kind:'video',sourceType:'video',protocol:'openai',executionMode:'async',allowedRatios:['16:9','1:1'],allowedSizes:['1K','2K'],qualityOptions:['std','pro'],maxOutputs:4,supportsReferenceImages:true,maxReferenceImages:4,supportsMask:false,allowedDurationsSeconds:[5,10],maxDurationSeconds:10,supportedOperations:['text-to-video','image-to-video','first-last-frame','multi-reference','video-extend'],outputKinds:['video'],capabilitySources:{}}]}});return;}
        if(key==='/bg-image/slow.png'){s.recoveryCalls++;await recoveryGate;await route.fulfill({contentType:'image/png',body:s.png});return;}
        if(key==='/bg-image/bad.png'){await route.fulfill({contentType:'image/png',body:'not-a-png'});return;}
        if (key === '/api/models?type=3d') { await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[],models:[],taskModelCatalog:[],modelAuthorizationMigration:{resolved:[],required:[]},quickCreatePolicy:{autoModelRouting:false,globalDefault:'',quickCreateDefault:''}}});return; }
        if (key === '/api/upscayl' || key === '/api/models?type=upscaler' || key === '/api/models?type=removebg') { await route.fulfill({json:key==='/api/upscayl'?{available:false,models:[]}:{success:true,providers:[],models:[]}});return; }
        if (HELP_FILES.some(file => key === '/api/help-image?file=' + file)) { await route.fulfill({contentType:'image/png',body:s.png});return; }
        if(isActivity){
          const body=request.postDataBuffer(),meta=await validateBIActivity({url:request.url(),method:request.method(),headers,body:body?Uint8Array.from(body):null,slot:count-1,statuses:s.uploadStatuses});
          console.log('BI_ACTIVITY',JSON.stringify({...meta,syntheticOnly:true}));await route.fulfill({json:{success:true}});return;
        }
        if(isUpload){
          if(!s.options.uploadMode||s.options.uploadMode==='oversize')throw Error('BI_UPLOAD_NOT_AUTHORIZED');
          const body=request.postDataBuffer(),meta=await validateBIUpload({url:request.url(),method:request.method(),headers,body:body?Uint8Array.from(body):null,slot:count-1,front:s.png,side:s.bluePng});
          s.uploadStatuses.push(s.options.uploadMode==='reject'?500:200);
          console.log('BI_UPLOAD',JSON.stringify({...meta,rejected:s.options.uploadMode==='reject',syntheticOnly:true}));
          if(s.options.uploadMode==='reject'){await route.fulfill({status:500,json:{success:false,error:'BI synthetic upload rejected'}});return;}
          await route.fulfill({json:{success:true,url:ORIGIN+'/bi-image/'+meta.role+'.png'}});return;
        }
        if(key==='/bi-image/front.png'||key==='/bi-image/side.png'){await route.fulfill({contentType:'image/png',body:key.includes('/front.')?s.png:s.bluePng});return;}
        if (key === '/logo.png') { await route.fulfill({contentType:'image/png',body:s.png});return; }
        throw Error('CANVAS_UI_FIXTURE_UNKNOWN_HTTP ' + key);
      })().catch(async error => { s.errors.push(String(error)); s.refused.add(route.request()); await route.abort('blockedbyclient'); });
      s.handlers.add(operation); try { await operation; } finally { s.handlers.delete(operation); }
    });
    await context.addInitScript(() => { const actor='omp-mobile-user',user={id:actor,username:'离线用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1};localStorage.setItem('unbounded_ai_current_user',actor);localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[actor]:{user,projects:[],apiKeys:[],usageStats:[]}}})); });
    await page.goto(ORIGIN); await page.addScriptTag({ content: bundle });
    console.log('BB_FETCH_RECEIVER_DIAG',JSON.stringify(await page.evaluate(async()=>{const errors:string[]=[];const holder={fetcher:window.fetch};try{await holder.fetcher('http://[');}catch(error){errors.push(String(error));}try{await window.fetch('http://[');}catch(error){errors.push(String(error));}return errors;})));
    s.png=Buffer.from((await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.png)).split(',')[1],'base64');
    s.bluePng=Buffer.from((await page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.blue)).split(',')[1],'base64');
    await page.evaluate(v => (window as unknown as FixtureWindow).canvasUi.mount(v.theme,v.options), {theme,options}); s.mounted = true;
    await page.locator(options.directMotion?'section[aria-label="独立运动笔刷"]':'[data-floating-panel="video"]').waitFor();
    await nativeRequestsFinished(s); await settle(page);

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
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/api/models?type=image','/api/models?type=chat','/api/models?type=video','/api/save-image','/api/activity','/bi-image/front.png','/bi-image/side.png','/bg-image/slow.png','/bg-image/bad.png','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}s.releaseRecovery();const beforeDrain={pending:s.pending.size,failed:s.failed.size};try{await nativeRequestsFinished(s);console.log('BI_PRE_UNMOUNT_DRAIN',JSON.stringify({beforeDrain,afterDrain:{pending:s.pending.size,failed:s.failed.size},notHistoricalTrace:true}));}catch(drain){primary=primary?new AggregateError([primary,drain],'BI_SCENARIO_AND_PRE_UNMOUNT_DRAIN'):drain;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}

async function click(s:Session,b:Locator):Promise<void>{await reveal(s,b);const r=await b.boundingBox();if(!r)throw Error('BI_RECT');expect(await b.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native center hit').toBe(true);await s.page.mouse.click(r.x+r.width/2,r.y+r.height/2);await settle(s.page);}
async function reveal(s:Session,b:Locator):Promise<void>{for(let i=0;i<20;i++){const step=await b.evaluate(e=>{const r=e.getBoundingClientRect(),parents:HTMLElement[]=[];for(let p=e.parentElement;p;p=p.parentElement)parents.push(p);for(const p of parents.reverse()){const css=getComputedStyle(p),q=p.getBoundingClientRect(),top=Math.max(0,q.top+p.clientTop),bottom=Math.min(innerHeight,q.top+p.clientTop+p.clientHeight),left=Math.max(0,q.left+p.clientLeft),right=Math.min(innerWidth,q.left+p.clientLeft+p.clientWidth);let dx=0,dy=0;if(/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight){if(r.height<=bottom-top){if(r.top<top-.5)dy=r.top-top-3;else if(r.bottom>bottom+.5)dy=r.bottom-bottom+3;}else if(r.y+r.height/2<top+24||r.y+r.height/2>bottom-24)dy=r.y+r.height/2-(top+bottom)/2;}if(/auto|scroll/.test(css.overflowX)&&p.scrollWidth>p.clientWidth){if(r.left<left-.5)dx=r.left-left-3;else if(r.right>right+.5)dx=r.right-right+3;}if((dx||dy)&&bottom>top&&right>left)return {x:right-5,y:(top+bottom)/2,dx,dy};}return null;});if(!step)return;await s.page.mouse.move(step.x,step.y);await s.page.mouse.wheel(step.dx,step.dy);await settle(s.page);}throw Error('BI_BOUNDED_NATIVE_REVEAL');}
async function audit(s:Session,b:Locator,kind='control'):Promise<void>{await reveal(s,b);const v=await b.evaluate(e=>{const r=e.getBoundingClientRect(),css=getComputedStyle(e),faults:string[]=[];const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const g of range.getClientRects())if(g.left<r.left-.5||g.right>r.right+.5||g.top<r.top-.5||g.bottom>r.bottom+.5)faults.push('glyph-clipped');}return {tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,90)||e.getAttribute('placeholder'),width:r.width,height:r.height,font:Number.parseFloat(css.fontSize),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:[[r.x+r.width/2,r.y+r.height/2],[r.left+8,r.y+r.height/2],[r.right-8,r.y+r.height/2],[r.x+r.width/2,r.top+8],[r.x+r.width/2,r.bottom-8]].every(([x,y])=>e.contains(document.elementFromPoint(x,y))),faults};});console.log('BI_CONTROL',JSON.stringify({kind,...v}));expect.soft(v.width,v.name+' target width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' target height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' visible five-point target').toBe(true);expect.soft(v.faults,v.name+' complete glyphs').toEqual([]);if(['INPUT','SELECT','TEXTAREA'].includes(v.tag))expect.soft(v.font,v.name+' avoids mobile input zoom').toBeGreaterThanOrEqual(16);}



interface BIEntry {theme:Theme;width:number;height:number}
const MATRIX=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
let captureIndex=0;
function panel(s:Session):Locator{return s.page.locator('[data-floating-panel="video"]');}
function characters(s:Session):Locator{return panel(s).getByRole('button',{name:/^角色一致性/}).locator('xpath=..');}
async function capture(s:Session,e:BIEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/video-character-bi-native-20261019',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+(++captureIndex)+'-'+label+'.png');await s.page.screenshot({path:file});console.log('BI_CAPTURE',JSON.stringify({path:file,label,coze:false,physicalAndroid:false,fullCanvasWorkspace:false}));}
async function check(e:BIEntry,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{await withSession(e.theme,e.width,e.height,{touch:true,...options},async s=>{try{await click(s,panel(s).getByRole('button',{name:'图生视频',exact:true}));await click(s,characters(s).getByRole('button',{name:/^角色一致性/}));await run(s);await capture(s,e,'end');}catch(error){try{await capture(s,e,'failure');}catch(artifact){throw new AggregateError([error,artifact],'BI_SCENARIO_AND_CAPTURE');}throw error;}});}
async function chooser(s:Session,button:Locator):Promise<import('@playwright/test').FileChooser>{const waiting=s.page.waitForEvent('filechooser');await click(s,button);return waiting;}
async function upload(s:Session,role:'front'|'side'):Promise<void>{const button=characters(s).getByRole('button',{name:role==='front'?'角色正面':'角色侧面',exact:true}),picker=await chooser(s,button);await picker.setFiles({name:'bi-'+role+'.png',mimeType:'image/png',buffer:role==='front'?s.png:s.bluePng});await nativeRequestsFinished(s);await s.page.waitForFunction(value=>Array.from(document.images).some(i=>i.src===value.url&&i.complete&&i.naturalWidth===64&&i.naturalHeight===value.height),{url:ORIGIN+'/bi-image/'+role+'.png',height:role==='front'?64:128});}
for(const e of MATRIX){it('BI '+e.theme+' '+e.width+'x'+e.height+' cancels uploads and visibly removes only the chosen character',async()=>{
 await check(e,{uploadMode:'accept',captureGeneration:true},async s=>{
  const c=characters(s),front=c.getByRole('button',{name:'角色正面',exact:true}),side=c.getByRole('button',{name:'角色侧面',exact:true});
  await audit(s,front,'character-upload');await audit(s,side,'character-upload');
  const empty=await chooser(s,front);await empty.setFiles([]);await settle(s.page);expect(s.counts.get('/api/save-image')??0,'cancel produces no upload').toBe(0);
  await upload(s,'front');await upload(s,'side');
  const image=c.getByRole('img',{name:'character-front',exact:true}),card=image.locator('xpath=ancestor::div[.//button][1]'),remove=card.getByRole('button');
  await reveal(s,remove);await s.page.mouse.move(0,0);await settle(s.page);await audit(s,remove,'character-remove');
  expect.soft(await remove.getAttribute('aria-label'),'remove identifies front role').toBe('移除角色正面图片');
  expect.soft(await remove.evaluate(el=>{let opacity=1;for(let p:Element|null=el;p;p=p.parentElement){const css=getComputedStyle(p);opacity*=Number(css.opacity);if(css.display==='none'||css.visibility==='hidden')return 0;}return opacity;}),'remove is visible without hover').toBe(1);
  await capture(s,e,'two-characters');
  await reveal(s,remove);const box=await remove.boundingBox();if(!box)throw Error('BI_REMOVE_RECT');await s.page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await settle(s.page);
  expect(await c.getByRole('img',{name:'character-front',exact:true}).count()).toBe(0);expect(await c.getByRole('img',{name:'character-side',exact:true}).count()).toBe(1);expect(await c.getByRole('button',{name:'角色正面',exact:true}).count()).toBe(1);expect(await c.getByRole('button',{name:/^角色一致性/}).innerText()).toContain('1张');
  await panel(s).getByPlaceholder(/输入创意|描述你想生成的视频画面/).fill('BI public callback only');await click(s,panel(s).getByRole('button',{name:'生成视频',exact:true}));await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).canvasUi.state.generations.length===1);
  const refs=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.generations[0].characterReferences);expect(refs).toEqual([ORIGIN+'/bi-image/side.png']);expect(s.counts.get('/api/save-image')).toBe(2);expect(s.counts.get('/api/activity')).toBe(2);console.log('BI_REFERENCES',JSON.stringify({refs,syntheticCallbackOnly:true}));
 });
},25000);}

interface OwnedOversize {base:string;dir:string;file:string}
interface CreationFault {phase:'after-mkdir'|'after-open';observe(value:OwnedOversize):void}
async function oversized(fault?:CreationFault):Promise<OwnedOversize>{
 const base=path.resolve('output/playwright/video-character-bi-native-20261019',String(process.pid));await mkdir(base,{recursive:true});
 const dir=await mkdtemp(path.join(base,'oversize-')),value={base,dir,file:path.join(dir,'bi-front.png')};let fileCreated=false;
 try{
  fault?.observe(value);if(fault?.phase==='after-mkdir')throw Error('BI_CREATE_FAULT_after-mkdir');
  const handle=await open(value.file,'wx');fileCreated=true;
  try{if(fault?.phase==='after-open')throw Error('BI_CREATE_FAULT_after-open');await handle.truncate(20*1024*1024+1);}finally{await handle.close();}
  return value;
 }catch(primary){try{await cleanOversize(value,fileCreated);}catch(cleanup){throw new AggregateError([primary,cleanup],'BI_CREATION_AND_CLEANUP');}throw primary;}
}
async function cleanOversize(value:OwnedOversize,fileCreated=true):Promise<void>{const base=await realpath(value.base),dir=await realpath(value.dir),relative=path.relative(base,dir);if(!relative||relative.split(path.sep).includes('..')||path.isAbsolute(relative)||path.resolve(value.file)!==path.join(dir,'bi-front.png'))throw Error('BI_TEMP_EXACT_SCOPE');if(fileCreated)await unlink(value.file);await rmdir(value.dir);console.log('BI_TEMP_CLEANED',JSON.stringify({syntheticOnly:true,fileCreated,requestedSize:20*1024*1024+1,recoverableByRegeneration:true}));}
for(const phase of ['after-mkdir','after-open'] as const){it('BI creation fault '+phase+' closes and removes only owned artifacts',async()=>{
 let owned:OwnedOversize|undefined;await expect(oversized({phase,observe:value=>{owned=value;}})).rejects.toThrow('BI_CREATE_FAULT_'+phase);
 expect(owned).toBeDefined();if(!owned)throw Error('BI_CREATE_NOT_OBSERVED');await expect(realpath(owned.dir)).rejects.toMatchObject({code:'ENOENT'});
},25000);}
for(const mode of ['oversize','reject'] as const){it('BI upload '+mode+' keeps the role empty and forwards the public error',async()=>{
 const e:BIEntry={theme:'gold',width:390,height:844},temp=mode==='oversize'?await oversized():null;let primary:unknown,cleanup:unknown;
 try{await check(e,{uploadMode:mode,collectUploadError:true},async s=>{
  const front=characters(s).getByRole('button',{name:'角色正面',exact:true}),pick=await chooser(s,front);
  if(temp)await pick.setFiles(temp.file);else await pick.setFiles({name:'bi-front.png',mimeType:'image/png',buffer:s.png});
  console.log('BI_FILE_CHOSEN',JSON.stringify(await pick.element().evaluate(el=>{const file=(el as HTMLInputElement).files?.[0];return {name:file?.name,size:file?.size,type:file?.type};})));
  await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).canvasUi.state.uploadErrors.length===1);await nativeRequestsFinished(s);
  expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.uploadErrors)).toEqual([mode==='oversize'?'图片文件过大（最大 20MB）':'BI synthetic upload rejected']);expect(await characters(s).getByRole('img',{name:'character-front',exact:true}).count()).toBe(0);expect(await front.count()).toBe(1);expect(s.counts.get('/api/save-image')??0).toBe(mode==='oversize'?0:1);expect(s.counts.get('/api/activity')??0).toBe(mode==='oversize'?0:1);console.log('BI_UPLOAD_ERROR',JSON.stringify({mode,requests:s.counts.get('/api/save-image')??0,publicCallbackOnly:true}));
 });}catch(error){primary=error;}
 if(temp)try{await cleanOversize(temp);}catch(error){cleanup=error;}
 if(primary&&cleanup)throw new AggregateError([primary,cleanup],'BI_SCENARIO_AND_TEMP_CLEANUP');if(primary)throw primary;if(cleanup)throw cleanup;
},25000);}
