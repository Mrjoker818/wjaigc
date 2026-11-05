// @vitest-environment node
// Real VideoPanel/MotionBrushCanvas and shipped CSS. Public props only; no paid/business I/O.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
type Theme='gold'|'mono';
interface Options {admin?:boolean; requireMissing?:boolean; touch?:boolean;holdRecovery?:boolean;catalogLoading?:boolean;directMotion?:boolean;captureGeneration?:boolean}
interface FixtureWindow extends Window {canvasUi:{png:string;blue:string;updateImage(url:string):void;exportMotion():unknown;mount(theme:Theme,options:Options):void;unmount():void;state:{mounts:number;disposed:boolean;scopeChecks:number;images:unknown[];actions:string[];view:{offsetX:number;offsetY:number;zoom:number}|null;events:Array<{type:string;target:string}>;generations:Array<{firstFrameUrl?:string;motionBrush?:{maskDataUrl:string;trajectories:unknown[]}}>}}}
interface Session {context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;mounted:boolean;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;responseStatus:Map<Request,number>;nativeWaiters:Set<()=>void>;png:Buffer;releaseRecovery:()=>void;recoveryCalls:number}
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
const picture=document.createElement('canvas');picture.width=64;picture.height=64;const ctx=picture.getContext('2d');if(!ctx)throw Error('BG_NATIVE_CANVAS2D');ctx.fillStyle='#d17a35';ctx.fillRect(0,0,64,64);const png=picture.toDataURL();picture.height=128;ctx.fillStyle='#416b9c';ctx.fillRect(0,0,64,128);const blue=picture.toDataURL();
const state={mounts:0,disposed:false,scopeChecks:0,images:[],actions:[] as string[],view:null,events:[],closes:0,exports:[] as unknown[],generations:[] as unknown[]};
let updateImage:(url:string)=>void=()=>{throw Error('BG_NOT_MOUNTED');};let exportMotion:()=>unknown=()=>null;
function Entry({theme,directMotion,captureGeneration}:{theme:'gold'|'mono';directMotion:boolean;captureGeneration:boolean}):React.ReactElement{const [url,setUrl]=useState(png),[closed,setClosed]=useState(false);const api=useRef<MotionBrushCanvasHandle>(null);updateImage=setUrl;exportMotion=()=>api.current?.export()??null;const close=()=>{state.closes++;setClosed(true);};return <><OperationAuditClient/>{!closed&&(directMotion?<section aria-label="独立运动笔刷" style={{maxWidth:600,margin:8}}><MotionBrushCanvas ref={api} imageUrl={url} onExport={result=>state.exports.push(result)} onClose={close}/></section>:<VideoPanel floating selectedImageUrl={url} themeStyle={theme==='mono'?'monochrome':'gold'} onClose={close} onVideoGenerate={async params=>{if(!captureGeneration)throw Error('BG_UNEXPECTED_GENERATION');state.generations.push(params);return {};}} onError={message=>{throw Error('BG_UNEXPECTED_VIDEO_ERROR '+message);}}/>)}</>;}
Object.assign(window,{canvasUi:{state,png,blue,mount(theme:'gold'|'mono',options:{directMotion?:boolean;captureGeneration?:boolean}){if(state.mounts||state.disposed)throw Error('BG_REMOUNT');state.mounts++;document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');root.render(<Entry theme={theme} directMotion={options.directMotion===true} captureGeneration={options.captureGeneration===true}/>);},updateImage:(url:string)=>updateImage(url),exportMotion:()=>exportMotion(),unmount(){if(!state.disposed){state.disposed=true;root.unmount();}taskEventsClient.disconnect();}}});`;

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
        if(key==='/api/models?type=video'){await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[{id:'bg-offline',name:'BG合成供应商',isEnabled:true}],models:[{id:'kling-v3-video-generation',name:'BG合成视频模型',providerId:'bg-offline',type:'video',isDefault:true}],taskModelCatalog:[{providerId:'bg-offline',modelId:'kling-v3-video-generation',kind:'video',sourceType:'video',protocol:'openai',executionMode:'async',allowedRatios:['16:9','1:1'],allowedSizes:['1K','2K'],qualityOptions:['std','pro'],maxOutputs:4,supportsReferenceImages:true,maxReferenceImages:4,supportsMask:false,allowedDurationsSeconds:[5,10],maxDurationSeconds:10,supportedOperations:['text-to-video','image-to-video','first-last-frame','multi-reference','video-extend'],outputKinds:['video'],capabilitySources:{}}]}});return;}
        if(key==='/bg-image/slow.png'){s.recoveryCalls++;await recoveryGate;await route.fulfill({contentType:'image/png',body:s.png});return;}
        if(key==='/bg-image/bad.png'){await route.fulfill({contentType:'image/png',body:'not-a-png'});return;}
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
  const allowed=['/','/api/session','/api/auth/me','/api/task-events','/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/api/models?type=image','/api/models?type=chat','/api/models?type=video','/bg-image/slow.png','/bg-image/bad.png','/logo.png','/api/tasks/recover?projectId=canvas-ui-project',...HELP_FILES.map(file=>'/api/help-image?file='+file)];
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

async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}s.releaseRecovery();const beforeDrain={pending:s.pending.size,failed:s.failed.size};try{await nativeRequestsFinished(s);console.log('BG_PRE_UNMOUNT_DRAIN',JSON.stringify({beforeDrain,afterDrain:{pending:s.pending.size,failed:s.failed.size},notHistoricalTrace:true}));}catch(drain){primary=primary?new AggregateError([primary,drain],'BG_SCENARIO_AND_PRE_UNMOUNT_DRAIN'):drain;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'CANVAS_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}

async function click(s:Session,b:Locator):Promise<void>{await reveal(s,b);const r=await b.boundingBox();if(!r)throw Error('BG_RECT');expect(await b.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native center hit').toBe(true);await s.page.mouse.click(r.x+r.width/2,r.y+r.height/2);await settle(s.page);}
async function reveal(s:Session,b:Locator):Promise<void>{for(let i=0;i<20;i++){const step=await b.evaluate(e=>{const r=e.getBoundingClientRect(),parents:HTMLElement[]=[];for(let p=e.parentElement;p;p=p.parentElement)parents.push(p);for(const p of parents.reverse()){const css=getComputedStyle(p),q=p.getBoundingClientRect(),top=Math.max(0,q.top+p.clientTop),bottom=Math.min(innerHeight,q.top+p.clientTop+p.clientHeight),left=Math.max(0,q.left+p.clientLeft),right=Math.min(innerWidth,q.left+p.clientLeft+p.clientWidth);let dx=0,dy=0;if(/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight){if(r.height<=bottom-top){if(r.top<top-.5)dy=r.top-top-3;else if(r.bottom>bottom+.5)dy=r.bottom-bottom+3;}else if(r.y+r.height/2<top+24||r.y+r.height/2>bottom-24)dy=r.y+r.height/2-(top+bottom)/2;}if(/auto|scroll/.test(css.overflowX)&&p.scrollWidth>p.clientWidth){if(r.left<left-.5)dx=r.left-left-3;else if(r.right>right+.5)dx=r.right-right+3;}if((dx||dy)&&bottom>top&&right>left)return {x:right-5,y:(top+bottom)/2,dx,dy};}return null;});if(!step)return;await s.page.mouse.move(step.x,step.y);await s.page.mouse.wheel(step.dx,step.dy);await settle(s.page);}throw Error('BG_BOUNDED_NATIVE_REVEAL');}
async function audit(s:Session,b:Locator,kind='control'):Promise<void>{await reveal(s,b);const v=await b.evaluate(e=>{const r=e.getBoundingClientRect(),css=getComputedStyle(e),faults:string[]=[];const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walker.nextNode())){if(!n.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const g of range.getClientRects())if(g.left<r.left-.5||g.right>r.right+.5||g.top<r.top-.5||g.bottom>r.bottom+.5)faults.push('glyph-clipped');}return {tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,90)||e.getAttribute('placeholder'),width:r.width,height:r.height,font:Number.parseFloat(css.fontSize),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:[[r.x+r.width/2,r.y+r.height/2],[r.left+8,r.y+r.height/2],[r.right-8,r.y+r.height/2],[r.x+r.width/2,r.top+8],[r.x+r.width/2,r.bottom-8]].every(([x,y])=>e.contains(document.elementFromPoint(x,y))),faults};});console.log('BG_CONTROL',JSON.stringify({kind,...v}));expect.soft(v.width,v.name+' target width').toBeGreaterThanOrEqual(44);expect.soft(v.height,v.name+' target height').toBeGreaterThanOrEqual(44);expect.soft(v.inside&&v.hit,v.name+' visible five-point target').toBe(true);expect.soft(v.faults,v.name+' complete glyphs').toEqual([]);if(['INPUT','SELECT','TEXTAREA'].includes(v.tag))expect.soft(v.font,v.name+' avoids mobile input zoom').toBeGreaterThanOrEqual(16);}

interface BGEntry {theme:Theme;width:number;height:number}
const MATRIX=THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height})));
let captureIndex=0;
function panel(s:Session):Locator{return s.page.locator('[data-floating-panel="video"]');}
function motion(s:Session):Locator{return panel(s).getByRole('button',{name:/^运动笔刷/}).locator('xpath=..');}
async function capture(s:Session,e:BGEntry,label:string):Promise<void>{const dir=path.resolve('output/playwright/video-motion-bg-native-20261019',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,e.theme+'-'+e.width+'x'+e.height+'-'+(++captureIndex)+'-'+label+'.png');await s.page.screenshot({path:file});console.log('BG_CAPTURE',JSON.stringify({path:file,label,coze:false,physicalAndroid:false,fullCanvasWorkspace:false}));}
async function check(e:BGEntry,run:(s:Session)=>Promise<void>,options:Options={}):Promise<void>{await withSession(e.theme,e.width,e.height,options,async s=>{try{if(!options.directMotion){await click(s,panel(s).getByRole('button',{name:'图生视频',exact:true}));const first=panel(s).getByRole('img',{name:/首帧/});await first.waitFor();await s.page.waitForFunction(()=>Array.from(document.querySelectorAll('img')).some(el=>el.complete&&el.naturalWidth===64));await click(s,panel(s).getByRole('button',{name:/^运动笔刷/}));}await run(s);await capture(s,e,'end');}catch(error){await capture(s,e,'failure');throw error;}});}
async function ready(s:Session,container:Locator=motion(s)):Promise<void>{await expect.poll(async()=>container.locator('canvas:visible').count(),{timeout:1500}).toBe(2);expect(await container.locator('canvas').first().evaluate((el:HTMLCanvasElement)=>Array.from(el.getContext('2d')!.getImageData(0,0,1,1).data))).toEqual([209,122,53,255]);}
for(const e of MATRIX){it('BG '+e.theme+' '+e.width+'x'+e.height+' opens registered model motion brush with decoded real source pixels',async()=>{await check(e,async s=>{await ready(s);expect(await motion(s).getByText('加载中...',{exact:true}).count()).toBe(0);});},25000);}
it('BG corrupt image gives recoverable error instead of an endless loading state',async()=>{const e:BGEntry={theme:'gold',width:390,height:844};await check(e,async s=>{await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.updateImage(location.origin+'/bg-image/bad.png'));await nativeRequestsFinished(s);await expect.poll(async()=>s.page.getByRole('alert').count(),{timeout:1500}).toBe(1);expect(await s.page.getByText('加载中...',{exact:true}).count()).toBe(0);await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.updateImage((window as unknown as FixtureWindow).canvasUi.png));await ready(s,s.page.getByRole('region',{name:'独立运动笔刷'}).or(s.page.locator('section[aria-label="独立运动笔刷"]')));}, {directMotion:true});},25000);
it('BG pending source cannot export stale mask and late image cannot replace newer source',async()=>{const e:BGEntry={theme:'gold',width:390,height:844};await check(e,async s=>{const host=s.page.locator('section[aria-label="独立运动笔刷"]');await ready(s,host);const originalOverlay=host.locator('canvas').last();await reveal(s,originalOverlay);const originalBox=await originalOverlay.boundingBox();if(!originalBox)throw Error('BG_ORIGINAL_MASK_RECT');await s.page.mouse.move(originalBox.x+originalBox.width*.4,originalBox.y+originalBox.height*.5);await s.page.mouse.down();await s.page.mouse.move(originalBox.x+originalBox.width*.6,originalBox.y+originalBox.height*.5,{steps:6});await s.page.mouse.up();await settle(s.page);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.exportMotion()),'actual pre-existing mask export').not.toBeNull();await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.updateImage(location.origin+'/bg-image/slow.png'));await s.page.waitForFunction(()=>document.body.textContent?.includes('加载中...'));expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.exportMotion())).toBeNull();await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.updateImage((window as unknown as FixtureWindow).canvasUi.blue));await expect.poll(async()=>host.locator('canvas:visible').count(),{timeout:1500}).toBe(2);s.releaseRecovery();await nativeRequestsFinished(s);await settle(s.page);expect(await host.locator('canvas').first().evaluate((el:HTMLCanvasElement)=>Array.from(el.getContext('2d')!.getImageData(0,0,1,1).data))).toEqual([65,107,156,255]);const surface=await host.locator('canvas').last().boundingBox();if(!surface)throw Error('BG_TALL_RECT');console.log('BG_ASPECT',JSON.stringify(surface));expect(surface.width/surface.height,'non-square overlay keeps source aspect').toBeCloseTo(.5,2);}, {directMotion:true,holdRecovery:true});},25000);

async function confirmMaskAndTrajectory(s:Session):Promise<void>{const m=motion(s),canvas=m.locator('canvas').last();await ready(s);await mouseStroke(s,canvas);expect(await ink(canvas)).toBeGreaterThan(0);await click(s,m.getByRole('button',{name:'轨迹',exact:true}));await mouseStroke(s,canvas);await click(s,m.getByRole('button',{name:'确认',exact:true}));expect(await m.getByRole('button',{name:/^运动笔刷/}).innerText()).toContain('1轨迹');}
async function captureSubmission(s:Session):Promise<{firstFrameUrl?:string;motionBrush?:{maskDataUrl:string;trajectories:unknown[]}}>{await panel(s).getByPlaceholder(/输入创意\/剧本|描述你想生成的视频画面/).fill('BG isolated callback only');await click(s,panel(s).getByRole('button',{name:'生成视频',exact:true}));await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).canvasUi.state.generations.length===1);return s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.generations[0]);}
it('BG review valid confirmed mask and trajectory reach the real parent callback',async()=>{const e:BGEntry={theme:'gold',width:390,height:844};await check(e,async s=>{await confirmMaskAndTrajectory(s);const result=await captureSubmission(s);expect(result.firstFrameUrl).toBe(await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.png));expect(result.motionBrush?.trajectories).toHaveLength(1);expect(result.motionBrush?.maskDataUrl).toMatch(/^data:image\/png;base64,/);const pixels=await s.page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let white=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===255&&d[i+2]===255&&d[i+3]===255)white++;return {white,total:c.width*c.height};},result.motionBrush!.maskDataUrl);expect(pixels.white).toBeGreaterThan(0);expect(pixels.white).toBeLessThan(pixels.total);console.log('BG_REVIEW_PARENT_VALID',JSON.stringify({white:pixels.white,total:pixels.total,trajectories:result.motionBrush!.trajectories.length,localCallbackOnly:true}));},{captureGeneration:true});},25000);
it('BG review changing first frame invalidates old parent motion without resurrection',async()=>{const e:BGEntry={theme:'gold',width:390,height:844};await check(e,async s=>{await confirmMaskAndTrajectory(s);await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.updateImage((window as unknown as FixtureWindow).canvasUi.blue));await s.page.waitForFunction(()=>Array.from(document.images).some(i=>i.src===(window as unknown as FixtureWindow).canvasUi.blue&&i.complete));await settle(s.page);expect.soft(await motion(s).getByRole('button',{name:/^运动笔刷/}).innerText(),'B cannot use A confirmation').not.toContain('1轨迹');await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.updateImage((window as unknown as FixtureWindow).canvasUi.png));await ready(s);expect.soft(await motion(s).getByRole('button',{name:/^运动笔刷/}).innerText(),'returning to A cannot resurrect invalidated confirmation').not.toContain('1轨迹');const result=await captureSubmission(s);expect.soft(result.motionBrush,'actual callback cannot submit stale motion').toBeUndefined();console.log('BG_REVIEW_PARENT_REPLACED',JSON.stringify({oldMotionPresent:!!result.motionBrush,localCallbackOnly:true}));},{captureGeneration:true});},25000);
it('BG review secondary touch capture loss preserves primary stroke and outside capture',async()=>{
  const e:BGEntry={theme:'gold',width:390,height:844};
  await check(e,async s=>{
    await ready(s);
    const canvas=motion(s).locator('canvas').last();
    await reveal(s,canvas);
    await canvas.evaluate(el=>{
      for(const type of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture','pointercancel'])
        el.addEventListener(type,event=>{
          const p=event as PointerEvent;
          (window as unknown as FixtureWindow).canvasUi.state.events.push({type,target:JSON.stringify({id:p.pointerId,pointerType:p.pointerType,x:p.clientX,y:p.clientY,capture:(el as HTMLCanvasElement).hasPointerCapture(p.pointerId)})});
        });
    });
    const b=await canvas.boundingBox();
    if(!b)throw Error('BG_REVIEW_TOUCH_RECT');
    const cdp=await s.context.newCDPSession(s.page);
    const point=(x:number,id:number)=>({x:b.x+b.width*x,y:b.y+b.height*.5,id});
    try{
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(.2,11)]});
      await settle(s.page);
      const dot=await ink(canvas);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(.35,11)]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(.35,11),point(.6,22)]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(.35,11),point(.61,22)]});
      await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).canvasUi.state.events.filter(v=>v.type==='gotpointercapture'&&(JSON.parse(v.target) as {pointerType:string}).pointerType==='touch').length===2);
      const downs=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.events.filter(v=>v.type==='pointerdown').map(v=>JSON.parse(v.target) as {id:number;pointerType:string}).filter(v=>v.pointerType==='touch'));
      expect(downs).toHaveLength(2);
      // Native DOM capture release, not a dispatched/mocked PointerEvent.
      // This tests capture loss only, not a physical secondary-finger lift.
      await canvas.evaluate((el,id)=>{
        if(!el.hasPointerCapture(id))throw Error('BG_SECONDARY_NATIVE_CAPTURE_REQUIRED');
        el.releasePointerCapture(id);
      },downs[1].id);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(.35,11),point(.85,22)]});
      await settle(s.page);
      const lossEvents=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.events);
      console.log('BG_REVIEW_CAPTURE_LOSS_TRACE',JSON.stringify(lossEvents));
      const lostBeforePrimaryUp=lossEvents.some(v=>v.type==='lostpointercapture'&&(JSON.parse(v.target) as {id:number}).id===downs[1].id)&&!lossEvents.some(v=>v.type==='pointerup'&&(JSON.parse(v.target) as {id:number}).id===downs[0].id);
      expect(lostBeforePrimaryUp,'secondary capture is lost while original primary remains pressed').toBe(true);
      const before=await ink(canvas);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(.55,11),point(.85,22)]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(.8,11),point(.85,22)]});
      await settle(s.page);
      const after=await ink(canvas);
      expect.soft(before,'native move adds more than initial dot').toBeGreaterThan(dot);
      expect.soft(after,'secondary capture loss cannot cancel primary subsequent movement').toBeGreaterThan(before);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      console.log('BG_REVIEW_MULTITOUCH',JSON.stringify({dot,before,after,secondaryLostBeforePrimaryUp:lostBeforePrimaryUp,nativeReleasePointerCapture:true,physicalFingerLift:false}));
    }finally{await cdp.detach();}
    await reveal(s,canvas);
    const q=await canvas.boundingBox();
    if(!q)throw Error('BG_REVIEW_CAPTURE_RECT');
    await s.page.mouse.move(q.x+q.width*.25,q.y+q.height*.5);
    await s.page.mouse.down();
    await s.page.mouse.move(q.x+q.width+8,q.y+q.height*.5);
    await s.page.mouse.up();
    await settle(s.page);
    const events=await s.page.evaluate(()=>(window as unknown as FixtureWindow).canvasUi.state.events);
    expect(events.some(v=>{const p=JSON.parse(v.target) as {x:number;capture:boolean};return v.type==='pointermove'&&p.x>q.x+q.width&&p.capture;}),'native captured move delivered outside canvas').toBe(true);
    const stopped=await ink(canvas);
    await s.page.mouse.move(q.x+q.width*.8,q.y+q.height*.8);
    await settle(s.page);
    expect(await ink(canvas),'released primary no longer paints').toBe(stopped);
  },{touch:true});
},25000);
async function ink(canvas:Locator):Promise<number>{return canvas.evaluate((el:HTMLCanvasElement)=>{const d=el.getContext('2d')!.getImageData(0,0,el.width,el.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>10)n++;return n;});}
async function mouseStroke(s:Session,canvas:Locator):Promise<void>{await reveal(s,canvas);const b=await canvas.boundingBox();if(!b)throw Error('BG_STROKE_RECT');await s.page.mouse.move(b.x+b.width*.35,b.y+b.height*.5);await s.page.mouse.down();await s.page.mouse.move(b.x+b.width*.65,b.y+b.height*.5,{steps:8});await s.page.mouse.up();await settle(s.page);}
for(const e of MATRIX){it('BG '+e.theme+' '+e.width+'x'+e.height+' operates native motion tools touch and closes the section',async()=>{await check(e,async s=>{await ready(s);const m=motion(s),brush=m.getByRole('button',{name:'涂抹',exact:true}),bar=brush.locator('xpath=..'),canvas=m.locator('canvas').last();for(const button of await bar.locator('button').all())await audit(s,button,'motion-toolbar');await audit(s,m.getByRole('button',{name:/^运动笔刷/}),'motion-section');const range=bar.locator('input[type="range"]');await audit(s,range,'brush-size');expect.soft(await range.getAttribute('aria-label'),'brush size label').toBeTruthy();const close=bar.locator('button').filter({has:s.page.locator('svg.lucide-x')});expect.soft(await close.getAttribute('aria-label'),'motion close name').toBeTruthy();await reveal(s,canvas);const b=await canvas.boundingBox();if(!b)throw Error('BG_TOUCH_RECT');const cdp=await s.context.newCDPSession(s.page);try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*.35,y:b.y+b.height*.5,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width*.5,y:b.y+b.height*.5,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width*.65,y:b.y+b.height*.5,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(s.page);expect.soft(await ink(canvas),'native Chromium touch drag paints').toBeGreaterThan(0);await reveal(s,canvas);const q=await canvas.boundingBox();if(!q)throw Error('BG_CANCEL_RECT');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x+q.width*.3,y:q.y+q.height*.4,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await settle(s.page);const count=await ink(canvas);await s.page.mouse.move(q.x+q.width*.7,q.y+q.height*.7);await settle(s.page);expect.soft(await ink(canvas),'cancelled touch stops drawing').toBe(count);}finally{await cdp.detach();}await click(s,m.getByRole('button',{name:'清空',exact:true}));expect(await ink(canvas)).toBe(0);await mouseStroke(s,canvas);expect(await ink(canvas)).toBeGreaterThan(0);await click(s,m.getByRole('button',{name:'撤销',exact:true}));expect(await ink(canvas)).toBe(0);await mouseStroke(s,canvas);const painted=await ink(canvas);await click(s,m.getByRole('button',{name:'橡皮',exact:true}));await mouseStroke(s,canvas);expect(await ink(canvas)).toBeLessThan(painted);await click(s,m.getByRole('button',{name:'清空',exact:true}));await reveal(s,range);const old=Number(await range.inputValue());await range.press('ArrowRight');expect(Number(await range.inputValue())).toBe(old+1);await click(s,m.getByRole('button',{name:'轨迹',exact:true}));await mouseStroke(s,canvas);expect(await m.locator('svg[viewBox="0 0 64 64"] line').count()).toBe(1);await click(s,m.getByRole('button',{name:'确认',exact:true}));expect(await panel(s).getByRole('button',{name:/^运动笔刷.*1轨迹/}).count()).toBe(1);await capture(s,e,'native-tools');await click(s,close);await expect.poll(async()=>m.locator('canvas:visible').count(),{timeout:1500}).toBe(0);}, {touch:true});},25000);}

