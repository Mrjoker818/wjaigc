// @vitest-environment node
// Real Dashboard parent + real ordinary-user settings, never serialized markup.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type Request} from '@playwright/test';
import {beforeAll,afterAll,it} from 'vitest';
import {createOwnedOperations,acquireOwned} from '../../../tests/helpers/native-owned-operations';
import {createRequire} from 'node:module';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';

interface DashboardFixtureCompilation {javascript:string;css:string;proof:{javascript:string;stylesheet:string;sourceInputs:string[]};inputFiles:string[]}
const require=createRequire(import.meta.url);

const ENTRY=String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import DashboardView from '@/components/dashboard/dashboard-view';
import {UserManager} from '@/lib/user-manager';import type {User} from '@/lib/user-types';
const user:User={id:'ph-ordinary-user',name:'PH 合成普通用户',password:'',role:'user',status:'active',createdAt:1,updatedAt:1,productType:'canvas'};
localStorage.setItem('unbounded_ai_user_data',JSON.stringify({users:[user],userData:{[user.id]:{user,projects:[],apiKeys:[],usageStats:[]}}}));
localStorage.setItem('unbounded_ai_current_user',user.id);
const root=createRoot(document.getElementById('fixture-root')!);
const state={open:0,create:0,logout:0,theme:0,errors:[] as string[],events:[] as Array<{type:string;trusted:boolean;pointer:string}>};
for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>state.events.push({type,trusted:event.isTrusted,pointer:event instanceof PointerEvent?event.pointerType:''}),{passive:true});
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(error:Error){state.errors.push(error.message);}render(){return this.state.failed?null:this.props.children;}}
Object.assign(window,{ph:{mount:(theme:string)=>{document.documentElement.classList.toggle('dark',theme==='gold');document.documentElement.classList.toggle('theme-monochrome',theme==='mono');root.render(<Boundary><DashboardView user={user} isMonochrome={theme==='mono'} onOpenProject={()=>{state.open++;throw Error('PH_OPEN_FORBIDDEN');}} onNewProject={()=>{state.create++;throw Error('PH_CREATE_FORBIDDEN');}} onLogout={()=>{state.logout++;throw Error('PH_LOGOUT_FORBIDDEN');}} onSetIsMonochrome={()=>{state.theme++;throw Error('PH_THEME_WRITE_FORBIDDEN');}}/></Boundary>);},unmount:()=>root.unmount(),snapshot:()=>({...state,storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).sort(([a],[b])=>a.localeCompare(b)))),actor:UserManager.getInstance().getCurrentUserId()})}});
`;

async function compileDashboard():Promise<DashboardFixtureCompilation>{
  const {build}=require('esbuild') as typeof import('esbuild');
  const NativeRegExp=require('node:vm').runInThisContext('RegExp') as RegExpConstructor;
  const output=await build({write:false,outfile:'ph-dashboard.js',bundle:true,metafile:true,platform:'browser',format:'iife',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env.__NEXT_CACHE_COMPONENTS':'false','__dirname':'"/"'},inject:['task5-next-client-process'],plugins:[{name:'next-official-browser-variants',setup(builder:import('esbuild').PluginBuild){
    const {browserVariantModules}=require('next/dist/build/browser-variant-modules') as {browserVariantModules:string[]};
    const variants=new Map(browserVariantModules.map(id=>[require.resolve(`next/dist/${id}.js`),require.resolve(`next/dist/${id}.browser.js`)]));
    const filter=/(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
    builder.onResolve({filter:new NativeRegExp('^task5-next-client-process$')},()=>({path:'task5-next-client-process',namespace:'task5-framework-host'}));
    builder.onLoad({filter:new NativeRegExp('.*'),namespace:'task5-framework-host'},()=>({contents:"export { default as process } from 'next/dist/compiled/process';",loader:'js',resolveDir:process.cwd()}));
    const utilImporters=new Set([require.resolve('ag-psd/dist/abr.js'),require.resolve('ag-psd/dist/additionalInfo.js')].map(file=>path.resolve(file)));
    builder.onResolve({filter:new NativeRegExp('^util$')},args=>args.importer&&utilImporters.has(path.resolve(args.importer))?{path:require.resolve('next/dist/compiled/util')}:undefined);
    builder.onResolve({filter:new NativeRegExp(filter.source,filter.flags)},args=>{if(!args.importer)return;const actual=createRequire(args.importer).resolve(args.path),browser=variants.get(actual);return browser?{path:browser}:undefined;});
  }}],stdin:{contents:ENTRY,resolveDir:process.cwd(),loader:'tsx',sourcefile:'ph-real-dashboard-entry.tsx'}});
  const js=output.outputFiles.filter(file=>file.path.endsWith('.js')),extraCss=output.outputFiles.filter(file=>file.path.endsWith('.css'));
  if(js.length!==1||extraCss.length>1||!output.metafile)throw Error('PH_BUNDLE_SHAPE');
  const inputs=Object.keys(output.metafile.inputs).filter(file=>!file.startsWith('task5-framework-host:')&&file!=='ph-real-dashboard-entry.tsx');
  const sources=inputs.filter(file=>/^src[\\/]/.test(file)&&/\.[jt]sx?$/.test(file));
  const styles:string[]=[];
  const compiler=await compile(fs.readFileSync('src/app/globals.css','utf8'),{base:process.cwd(),loadStylesheet:async(id:string,base:string)=>{
    const file=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?path.resolve('node_modules/tw-animate-css/dist/tw-animate.css'):require.resolve(id.startsWith('.')?path.resolve(base,id):id);
    styles.push(path.resolve(file).replaceAll('\\','/'));return{path:file,base:path.dirname(file),content:fs.readFileSync(file,'utf8')};
  }});
  const css=compiler.build(new Scanner({}).scanFiles([...sources.map(file=>({content:fs.readFileSync(file,'utf8'),extension:path.extname(file).slice(1)})),{content:ENTRY,extension:'tsx'}]))+'\n'+(extraCss[0]?.text??'');
  const javascript=js[0].text;
  const hash=(value:string):string=>createHash('sha256').update(value).digest('hex');
  return{javascript,css,proof:{javascript:hash(javascript),stylesheet:hash(css),sourceInputs:sources.sort()},inputFiles:[...new Set([...inputs.map(file=>path.resolve(file).replaceAll('\\','/')),...styles,path.resolve('src/app/globals.css').replaceAll('\\','/')])].sort()};
}

const ORIGIN='https://ph-dashboard-ordinary.invalid';
const SHOTS=path.resolve('output/playwright/dashboard-settings-parent-touch-native',String(process.pid));
const owned=createOwnedOperations(),contexts=new Set<BrowserContext>(),contextClose=new Map<BrowserContext,Promise<void>>();
let browser:Browser|undefined,browserClose:Promise<void>|undefined,closing=false,ownsOutput=false,disconnected=false,created=0,closed=0;
let javascript='',css='',compilation:unknown,assetBytes:Buffer;
const ASSET_SHA='9abd59bda2a09877aa290f5c30ec7ced29eb101b1def5a11d02e81c77489967c';
interface Snapshot {open:number;create:number;logout:number;theme:number;actor:string|null;storage:string;errors:string[];events:Array<{type:string;trusted:boolean;pointer:string}>}
interface FixtureWindow extends Window {ph:{mount:(theme:string)=>void;unmount:()=>void;snapshot:()=>Snapshot}}
interface Session {context:BrowserContext;page:Page;faults:string[];pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;counts:Map<string,number>;handlers:Set<Promise<void>>;waiters:Set<()=>void>;mounted:boolean;images:Array<{complete:boolean;width:number;height:number;source:string}>}
interface Metrics {width:number;height:number;clear:boolean;hit:boolean;opacity:number;hint:{x:number;y:number;delta:number}|null}
const rows:Array<Record<string,unknown>>=[];
const run=<T>(name:string,action:()=>Promise<T>,ms=2500):Promise<T>=>owned.run('PH-'+name,action,ms);
function closeContext(context:BrowserContext):Promise<void>{let promise=contextClose.get(context);if(!promise){promise=context.close();contextClose.set(context,promise);}return promise;}
function closeBrowser(value:Browser):Promise<void>{browserClose??=value.close();return browserClose;}
async function settle(page:Page):Promise<void>{await run('settle',()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))));}
async function snapshot(page:Page):Promise<Snapshot>{return run('snapshot',()=>page.evaluate(()=>(window as unknown as FixtureWindow).ph.snapshot()));}
async function finished(s:Session):Promise<void>{let notify:(()=>void)|undefined;try{await run('requests-finished',()=>new Promise<void>(resolve=>{notify=()=>{if(!s.pending.size&&!s.handlers.size)resolve();};s.waiters.add(notify);notify();}));}finally{if(notify)s.waiters.delete(notify);}}

beforeAll(async()=>{
  assert.equal(fs.existsSync(SHOTS),false);fs.mkdirSync(path.dirname(SHOTS),{recursive:true});fs.mkdirSync(SHOTS);ownsOutput=true;
  assetBytes=fs.readFileSync(path.resolve('public/gallery/cat-0/g2.jpg'));assert.equal(assetBytes.length,19141);assert.equal(createHash('sha256').update(assetBytes).digest('hex'),ASSET_SHA);
  const compiled=await run('compile',()=>compileDashboard(),30000);javascript=compiled.javascript;css=compiled.css;compilation=compiled.proof;
  if(closing)throw Error('PH_STARTUP_CLOSED');
  browser=await acquireOwned(owned,'PH-browser',async()=>{if(closing)throw Error('PH_STARTUP_CLOSED');const value=await chromium.launch({headless:true});value.once('disconnected',()=>{disconnected=true;});return value;},closeBrowser,()=>closing,15000);
},60000);

async function open(theme:string,width:number,height:number):Promise<Session>{
  if(!browser)throw Error('PH_BROWSER_REQUIRED');
  const context=await acquireOwned(owned,'PH-context',async()=>{const value=await browser!.newContext({viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce',serviceWorkers:'block'});contexts.add(value);created++;value.once('close',()=>{closed++;contexts.delete(value);});return value;},closeContext,()=>closing,2500);
  try{
    const page=await acquireOwned(owned,'PH-page',()=>context.newPage(),value=>value.close(),()=>closing,2500);page.setDefaultTimeout(1500);
    const s:Session={context,page,mounted:false,images:[],faults:[],pending:new Set(),completed:new Set(),failed:new Set(),counts:new Map(),handlers:new Set(),waiters:new Set()};
    context.on('request',request=>s.pending.add(request));context.on('requestfinished',request=>{s.pending.delete(request);s.completed.add(request);for(const notify of s.waiters)notify();});context.on('requestfailed',request=>{s.pending.delete(request);s.failed.add(request);for(const notify of s.waiters)notify();});
    page.on('pageerror',error=>s.faults.push(String(error)));page.on('dialog',dialog=>{s.faults.push('PH_UNEXPECTED_DIALOG');void dialog.dismiss().catch(error=>s.faults.push(String(error)));});
    await run('deny-ws',()=>context.routeWebSocket('**/*',socket=>{s.faults.push('PH_UNEXPECTED_WS');socket.close({code:1008,reason:'isolated fixture'});}));
    await run('routes',()=>context.route('**/*',async route=>{
      const operation=(async()=>{
        const request=route.request(),url=new URL(request.url()),headers=request.headers(),key=request.method()+' '+url.pathname;
        if(url.origin!==ORIGIN||url.search||url.hash||url.username||url.password||request.postData()!==null||request.method()!=='GET'||headers.authorization||headers.cookie||headers['x-api-key']||headers['api-key'])throw Error('PH_HTTP_BOUNDARY');
        s.counts.set(key,(s.counts.get(key)??0)+1);if(s.counts.get(key)!==1&&!(key==='GET /gallery/cat-0/g2.jpg'&&s.counts.get(key)!<=2))throw Error('PH_HTTP_COUNT '+key);
        if(key==='GET /'&&request.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="fixture-root"></div></body></html>'});return;}
        if(key==='GET /gallery/cat-0/g2.jpg'&&request.resourceType()==='image'){await route.fulfill({contentType:'image/jpeg',headers:{'cache-control':'no-store'},body:assetBytes});return;}
        if(key==='GET /api/credits/payment-status'&&request.resourceType()==='fetch'){await route.fulfill({json:{success:true,status:{alipay:false,wechat:false}}});return;}
        throw Error('PH_UNKNOWN_HTTP '+key);
      })().catch(async error=>{s.faults.push(String(error));await route.abort('blockedbyclient');});
      s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);for(const notify of s.waiters)notify();}
    }));
    await run('goto',()=>page.goto(ORIGIN));await run('script',()=>page.addScriptTag({content:javascript}));await run('mount',()=>page.evaluate(theme=>(window as unknown as FixtureWindow).ph.mount(theme),theme));s.mounted=true;
    await run('initial-heading',()=>page.getByRole('heading',{name:'我的项目',exact:true}).waitFor());await decodedImage(s);await finished(s);await settle(page);assert.equal(s.counts.get('GET /api/credits/payment-status'),1);return s;
  }catch(error){await run('failed-start-close',()=>closeContext(context));throw error;}
}

async function decodedImage(s:Session):Promise<void>{
  await run('actual-demo-image-decode',async()=>{const handle=await s.page.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('img[src="/gallery/cat-0/g2.jpg"]');return !!image&&image.complete&&image.naturalWidth>0&&image.naturalHeight>0;},undefined,{timeout:1500});await handle.dispose();});
  const observed=await run('actual-demo-image-shape',()=>s.page.locator('img[src="/gallery/cat-0/g2.jpg"]').evaluate(element=>{const image=element as HTMLImageElement;return{complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,source:image.currentSrc};}));
  assert.equal(observed.source,ORIGIN+'/gallery/cat-0/g2.jpg');assert.equal(observed.complete,true);assert.ok(observed.width>0&&observed.height>0);s.images.push(observed);
}
async function metrics(control:Locator):Promise<Metrics>{return run('metrics',()=>control.evaluate(element=>{
  const rect=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight,opacity=1,hint:Metrics['hint']=null;
  for(let parent:Element|null=element;parent;parent=parent.parentElement){const style=getComputedStyle(parent),r=parent.getBoundingClientRect();opacity*=Number(style.opacity);
    if(parent!==element){if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,r.left+parent.clientLeft);right=Math.min(right,r.left+parent.clientLeft+parent.clientWidth);}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,r.top+parent.clientTop);bottom=Math.min(bottom,r.top+parent.clientTop+parent.clientHeight);}
      if(!hint&&/auto|scroll/.test(style.overflowY)&&parent.scrollHeight>parent.clientHeight&&(rect.top<r.top+parent.clientTop+1||rect.bottom>r.top+parent.clientTop+parent.clientHeight-1)){
        const y1=Math.max(0,r.top+parent.clientTop),y2=Math.min(innerHeight,r.top+parent.clientTop+parent.clientHeight),x1=Math.max(0,r.left+parent.clientLeft),x2=Math.min(innerWidth,r.left+parent.clientLeft+parent.clientWidth);
        if(y2>y1&&x2>x1)hint={x:(x1+x2)/2,y:(y1+y2)/2,delta:rect.top<y1?rect.top-y1-4:rect.bottom-y2+4};
      }
    }
  }
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2,points=[[x,y],[rect.left+8,y],[rect.right-8,y],[x,rect.top+8],[x,rect.bottom-8]];
  return{width:rect.width,height:rect.height,clear:rect.left>=left-0.5&&rect.top>=top-0.5&&rect.right<=right+0.5&&rect.bottom<=bottom+0.5,opacity,hit:points.every(([x,y])=>element.contains(document.elementFromPoint(x,y))),hint};
}));}
async function reachable(s:Session,control:Locator):Promise<void>{
  for(let attempt=0;attempt<8;attempt++){const shape=await metrics(control);if(shape.clear&&shape.hit){assert.ok(shape.width>=44&&shape.height>=44,'PH_44PX_TARGET');assert.ok(shape.opacity>=0.95,'PH_VISIBLE_TARGET');return;}
    if(!shape.hint)throw Error('PH_TARGET_NOT_REACHABLE');await run('wheel-position',()=>s.page.mouse.move(shape.hint!.x,shape.hint!.y));await run('native-wheel',()=>s.page.mouse.wheel(0,shape.hint!.delta));await settle(s.page);
  }throw Error('PH_SCROLL_BOUND');
}
async function tap(s:Session,control:Locator):Promise<void>{await reachable(s,control);await run('touch',()=>control.tap());await settle(s.page);}
async function dispose(s:Session):Promise<void>{
  const failures:unknown[]=[];
  try{if(s.mounted)await run('unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).ph.unmount()));s.mounted=false;await run('route-drain',()=>Promise.all([...s.handlers]));await finished(s);}catch(error){failures.push(error);}
  try{await run('context-close',()=>closeContext(s.context));}catch(error){failures.push(error);}
  try{assert.deepEqual(s.faults,[]);assert.equal(s.pending.size,0);assert.equal(s.handlers.size,0);assert.equal(s.failed.size,0);const reads=s.counts.get('GET /gallery/cat-0/g2.jpg');assert.ok(reads===1||reads===2);assert.equal(s.completed.size,2+reads);assert.deepEqual([...s.counts.entries()],[['GET /',1],['GET /api/credits/payment-status',1],['GET /gallery/cat-0/g2.jpg',reads]]);}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'PH_DISPOSAL_FAILURE');
}

const MATRIX=[{theme:'gold',width:320,height:640},{theme:'mono',width:320,height:640},{theme:'gold',width:844,height:390},{theme:'mono',width:844,height:390}];
it.each(MATRIX)('$theme $width x $height ordinary dashboard parent touch navigation and settings cancellation',async({theme,width,height})=>{
  const s=await open(theme,width,height);let failed=false,error:unknown,cleanupFailed=false,cleanup:unknown,before:Snapshot|undefined,after:Snapshot|undefined,device:unknown;
  try{
    device=await run('device',()=>s.page.evaluate(()=>({touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,noHover:matchMedia('(hover:none)').matches})));assert.deepEqual(device,{touch:1,coarse:true,noHover:true});
    before=await snapshot(s.page);assert.equal(before.actor,'ph-ordinary-user');assert.deepEqual(before.errors,[]);
    const trigger=s.page.getByRole('button',{name:'展开导航',exact:true}),nav=s.page.getByRole('complementary',{name:'工作台导航',exact:true}),mobile=width<768;
    if(mobile){assert.equal(await trigger.isVisible(),true);assert.equal(await nav.isVisible(),false);await tap(s,trigger);assert.equal(await trigger.getAttribute('aria-expanded'),'true');}else{assert.equal(await trigger.isVisible(),false);assert.equal(await nav.isVisible(),true);}
    assert.equal(await nav.getByRole('button',{name:'用户管理',exact:true}).count(),0);
    await tap(s,nav.getByRole('button',{name:'设置',exact:true}));await run('settings-heading',()=>s.page.getByRole('heading',{name:'个人资料',exact:true}).waitFor());
    if(mobile){assert.equal(await nav.isVisible(),false);assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await run('settings-return-focus',()=>trigger.evaluate(element=>document.activeElement===element)),true);}else assert.equal(await nav.isVisible(),true);
    await tap(s,s.page.getByRole('button',{name:'修改密码',exact:true}));await run('password-heading',()=>s.page.getByRole('heading',{name:'修改密码',exact:true}).waitFor());
    for(const label of ['新密码','确认密码'])assert.ok(await run('password-font',()=>s.page.getByLabel(label,{exact:true}).evaluate(element=>parseFloat(getComputedStyle(element).fontSize)))>=16);
    await run('password-capture',()=>s.page.screenshot({path:path.join(SHOTS,theme+'-'+width+'-'+height+'-password.png')}));
    await tap(s,s.page.getByRole('button',{name:'关闭修改密码',exact:true}));assert.equal(await s.page.getByRole('heading',{name:'修改密码',exact:true}).count(),0);
    if(mobile)await tap(s,trigger);
    await tap(s,nav.getByRole('button',{name:/^我的项目/}));await run('projects-heading',()=>s.page.getByRole('heading',{name:'我的项目',exact:true}).waitFor());
    if(mobile){assert.equal(await trigger.getAttribute('aria-expanded'),'false');await tap(s,trigger);await tap(s,s.page.getByRole('button',{name:'关闭导航',exact:true}));assert.equal(await nav.isVisible(),false);assert.equal(await run('close-return-focus',()=>trigger.evaluate(element=>document.activeElement===element)),true);}
    await decodedImage(s);await finished(s);after=await snapshot(s.page);assert.equal(after.storage,before.storage);assert.equal(after.actor,before.actor);assert.deepEqual(after.errors,[]);assert.deepEqual([after.open,after.create,after.logout,after.theme],[0,0,0,0]);assert.ok(after.events.filter(event=>event.type==='pointerdown'&&event.trusted&&event.pointer==='touch').length>=(mobile?8:4));
    await run('final-capture',()=>s.page.screenshot({path:path.join(SHOTS,theme+'-'+width+'-'+height+'-projects.png')}));
  }catch(caught){failed=true;error=caught;}
  try{await dispose(s);}catch(caught){cleanupFailed=true;cleanup=caught;}
  const row={theme,width,height,bodyComplete:!failed,closed:!contexts.has(s.context),device,images:s.images,before,after,faults:s.faults,requests:[...s.counts.entries()],pending:s.pending.size,handlers:s.handlers.size,finished:s.completed.size,failedRequests:s.failed.size,error:failed?{name:(error as Error)?.name??typeof error,message:String(error)}:null,cleanup:cleanupFailed?String(cleanup):null};rows.push(row);
  if(ownsOutput)fs.writeFileSync(path.join(SHOTS,theme+'-'+width+'-'+height+'-case.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx'});
  if(cleanupFailed)throw new AggregateError(failed?[error,cleanup]:[cleanup],'PH_BODY_AND_CLEANUP');if(failed)throw error;
},25000);

afterAll(async()=>{
  closing=true;const errors:unknown[]=[];
  for(const context of contexts)try{await run('final-context-close',()=>closeContext(context));}catch(error){errors.push(error);}
  if(browser)try{await run('browser-close',()=>closeBrowser(browser!),5000);}catch(error){errors.push(error);}
  const pending=owned.pendingPromises();if(pending.length)try{await run('final-drain',()=>Promise.allSettled(pending),2500);}catch(error){errors.push(error);}
  const operations=owned.snapshot(),resource={browserDisconnected:disconnected,browserConnected:browser?.isConnected()??false,contextsCreated:created,contextsActuallyClosed:closed,contextsRemaining:contexts.size,operations,errors:errors.map(String),rows,compilation,asset:{bytes:assetBytes?.length??0,sha256:assetBytes?createHash('sha256').update(assetBytes).digest('hex'):null},noSql:true,noSave:true,physicalAndroid:false,cloud:false};
  if(ownsOutput)fs.writeFileSync(path.join(SHOTS,'resources.json'),JSON.stringify(resource,null,2)+'\n',{flag:'wx'});
  assert.equal(contexts.size,0);assert.equal(created,closed);if(browser)assert.equal(disconnected,true);assert.deepEqual(operations.pending,[]);assert.deepEqual(operations.lateErrors,[]);assert.equal(operations.operations.every(operation=>operation.settled&&!operation.timedOut&&!operation.rejected),true);if(errors.length)throw new AggregateError(errors,'PH_FINAL_RESOURCES');
},15000);

