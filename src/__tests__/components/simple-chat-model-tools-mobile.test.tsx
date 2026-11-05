// @vitest-environment node
// Real production model tools / ChatArea / Providers / full CSS. Synthetic .invalid HTTP only.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
type Theme='gold'|'mono';
type Surface='optimizer'|'compare'|'chat';
type Reply='ok'|'http'|'network'|'invalid-json'|'invalid-object'|'empty'|'sse-error'|'truncated'|'malformed'|'json';
interface Operation{kind:'optimize'|'compare';key?:string;mode?:'enhance'|'expand'|'simplify';reply?:Reply;hold?:boolean}
interface Options{surface?:Surface;modelCount?:number;ops?:Operation[]}
interface Gate{wait:Promise<void>;release():void}
interface FixtureWindow extends Window{scUi:{mount(theme:Theme,options:Options):void;unmount():void;state:{disposed:boolean;applied:string[];closed:number}}}
interface Session{context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;plannedFailed:Set<Request>;nativeWaiters:Set<()=>void>;gates:Gate[];mounted:boolean;consumed:Set<number>;bodies:Array<{path:string;body:Record<string,unknown>}>}
const ORIGIN='https://simple-chat-model-tools-mobile.invalid';
const THEMES:Theme[]=['gold','mono'];
const QUESTION='移动端合成问题';
const ANSWER='优化后的完整文案\nhttps://result.invalid/'+('long-segment'.repeat(20))+' 最后一段';
const MODEL_FIXTURE=[{id:'shared-model',providerId:'provider-a',providerName:'供应商甲',displayName:'同名模型甲 长名称检查边界'},{id:'shared-model',providerId:'provider-b',providerName:'供应商乙',displayName:'同名模型乙 长名称检查边界'},{id:'third-model',providerId:'provider-c',providerName:'供应商丙',displayName:'第三模型 长名称检查边界'}];
const modelKey=(i:number):string=>MODEL_FIXTURE[i].providerId+'::'+MODEL_FIXTURE[i].id;
const modelAnswer=(i:number):string=>'模型回答'+i+' 中文\nhttps://result.invalid/'+('long-answer'.repeat(30));
const ENTRY=String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatArea from '@/components/simple-chat/chat-area';
import {PromptOptimizer} from '@/components/simple-chat/prompt-optimizer';
import {ModelCompare} from '@/components/simple-chat/model-compare';
import {Providers,useTheme} from '@/app/simple-chat/providers';
import {Toaster} from 'sonner';
import type {SimpleChatProject,SimpleChatTask} from '@/components/simple-chat/simple-chat-types';
const models=[{id:'shared-model',providerId:'provider-a',providerName:'供应商甲',displayName:'同名模型甲 长名称检查边界'},{id:'shared-model',providerId:'provider-b',providerName:'供应商乙',displayName:'同名模型乙 长名称检查边界'},{id:'third-model',providerId:'provider-c',providerName:'供应商丙',displayName:'第三模型 长名称检查边界'}];
const seed:SimpleChatProject={id:'project-one',name:'合成项目',createdAt:1,updatedAt:1,agents:[],knowledgeItems:[],tasks:[{id:'task-one',projectId:'project-one',name:'合成对话',messages:[],model:'',providerId:'',createdAt:1,updatedAt:1}]};
const user={id:'synthetic-mobile-user',name:'仅本地界面合成用户',role:'user' as const,status:'active' as const,productType:'chat' as const,createdAt:1,updatedAt:1};
const root=createRoot(document.getElementById('fixture-root')!);let mounted=false;
const state={disposed:false,applied:[] as string[],closed:0};
function Entry({options}:{options:{surface?:'optimizer'|'compare'|'chat';modelCount?:number}}){
 const [project,setProject]=useState(seed),[open,setOpen]=useState(true);const {theme}=useTheme();
 const close=()=>{state.closed++;setOpen(false);};const unavailable=()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_WRITE');};
 return <div className="h-full w-full min-w-0 overflow-hidden">{options.surface==='chat'?<ChatArea user={user} project={project} task={project.tasks[0]} onUpdateTask={(task:SimpleChatTask)=>setProject(p=>({...p,tasks:[task]}))} onPersistTask={async()=>{unavailable();}} onUpdateProject={setProject} onCreateTask={unavailable} onSelectTask={unavailable} onUpdateAgent={unavailable} onDeleteAgent={unavailable} onSkillToAgent={unavailable} onLogout={unavailable} onBackToWorkspace={unavailable} sidebarOpen={false} onToggleSidebar={unavailable}/>:open?(options.surface==='compare'?<ModelCompare isMonochrome={theme!=='dark'} prompt="" models={models.slice(0,options.modelCount??3)} onClose={close}/>:<PromptOptimizer isMonochrome={theme!=='dark'} currentPrompt="" onApply={s=>state.applied.push(s)} onClose={close}/>):<button onClick={()=>setOpen(true)} className="min-h-11 min-w-11">重新打开</button>}<Toaster/></div>;
}
Object.assign(window,{scUi:{state,mount(theme:'gold'|'mono',options:{surface?:'optimizer'|'compare'|'chat';modelCount?:number}){if(mounted||state.disposed)throw Error('SC_UI_FIXTURE_REMOUNT');mounted=true;localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');root.render(<Providers><Entry options={options}/></Providers>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser:Browser|undefined;let bundle='',css='';
const live=new Set<Session>(),contexts=new Set<BrowserContext>();
beforeAll(async () => {
  // Same native loader and exact installed Next/ag-psd browser boundaries as the
  // reviewed additional-tools-b aspect host. No component or hook replacements.
  if (typeof process.getBuiltinModule !== 'function') throw Error('SC_UI_FIXTURE_NATIVE_LOADER_REQUIRED');
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-chat-model-tools-mobile-entry.tsx' },
  });
  if (result.outputFiles.length !== 1) throw Error('SC_UI_FIXTURE_MEMORY_BUNDLE_REQUIRED');
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
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('SC_UI_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function target(control: Locator): Promise<void> {
  const value = await control.evaluate(e => { const r = e.getBoundingClientRect(); let clear = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let p = e.parentElement; p; p = p.parentElement) { const b = p.getBoundingClientRect(), s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && (r.left < b.left + p.clientLeft - 0.5 || r.right > b.left + p.clientLeft + p.clientWidth + 0.5)) clear = false; if (/(auto|scroll|hidden|clip)/.test(s.overflowY) && (r.top < b.top + p.clientTop - 0.5 || r.bottom > b.top + p.clientTop + p.clientHeight + 0.5)) clear = false; }
    const x = r.x + r.width / 2, y = r.y + r.height / 2; return { width: r.width, height: r.height, clear, hit: [[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b]) => e.contains(document.elementFromPoint(a,b))) }; });
  expect(value.width, 'target width').toBeGreaterThanOrEqual(44); expect(value.height, 'target height').toBeGreaterThanOrEqual(44); expect(value.clear, 'whole target visible').toBe(true); expect(value.hit, 'native hit').toBe(true);
}

async function textContrast(control: Locator, placeholder = false): Promise<number> {
  return control.evaluate((element, isPlaceholder) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('SC_UI_FIXTURE_CONTRAST_CANVAS');
    type Rgba = [number, number, number, number]; type Rgb = [number, number, number];
    const rgba = (value: string): Rgba => {
      if (!CSS.supports('color', value) || /^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value)) throw Error('SC_UI_FIXTURE_CONTRAST_COLOR');
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const blend = (front: Rgba, back: Rgb): Rgb => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])) as Rgb;
    const luminance = (rgb: Rgb): number => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (ratio([255, 255, 255], [255, 255, 255]) !== 1 || Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) > 0.000001) throw Error('SC_UI_FIXTURE_CONTRAST_CANARY');
    const layers: Rgba[] = []; let opaque = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backgroundImage !== 'none') throw Error('SC_UI_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
      const color = rgba(style.backgroundColor); layers.push(color); if (color[3] === 1) { opaque = true; break; }
    }
    if (!opaque) throw Error('SC_UI_FIXTURE_CONTRAST_BACKDROP_REQUIRED');
    let backdrop: Rgb = [255, 255, 255]; for (const layer of layers.reverse()) backdrop = blend(layer, backdrop);
    const own = getComputedStyle(element); if (own.filter !== 'none' || own.mixBlendMode !== 'normal' || own.backgroundImage !== 'none') throw Error('SC_UI_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
    const background = blend(rgba(own.backgroundColor), backdrop), ownOpacity = Number(own.opacity);
    const text = isPlaceholder ? getComputedStyle(element, '::placeholder') : own;
    const paint = rgba(text.color); if (isPlaceholder) paint[3] *= Number(text.opacity);
    return ratio(blend([...blend(paint, background), ownOpacity], backdrop), blend([...background, ownOpacity], backdrop));
  }, placeholder);
}


function gate():Gate{let release=():void=>{};const wait=new Promise<void>(resolve=>{release=resolve;});return{wait,release};}
const keyOf=(r:Request):string=>r.method()+' '+new URL(r.url()).pathname+new URL(r.url()).search;
function replyBody(op:Operation,index:number):{status:number;contentType:string;body:string}{
 if(op.reply==='http')return{status:403,contentType:'application/json',body:JSON.stringify({error:'合成服务拒绝'})};
 if(op.reply==='invalid-json')return{status:200,contentType:'application/json',body:'{invalid'};
 if(op.reply==='invalid-object')return{status:200,contentType:'application/json',body:JSON.stringify({success:true,optimized:{text:'not-a-string'}})};
 if(op.reply==='empty')return{status:200,contentType:'application/json',body:JSON.stringify({success:true,optimized:' '})};
 if(op.kind==='optimize')return{status:200,contentType:'application/json',body:JSON.stringify({success:true,optimized:ANSWER,model:'synthetic-model',providerId:'synthetic-provider'})};
 if(op.reply==='json')return{status:200,contentType:'application/json',body:JSON.stringify({content:'not-the-real-SSE-contract'})};
 if(op.reply==='malformed')return{status:200,contentType:'text/event-stream',body:'data: {broken\n\n'};
 const frames:Record<string,unknown>[]=[{type:'generation_controls',appliedReasoningEffort:'default',appliedResponseSpeed:'standard',degraded:false,notices:[],support:{}}];
 if(op.reply==='sse-error')frames.push({type:'error',error:'合成流式服务拒绝'});
 else{const content=modelAnswer(index),middle=content.indexOf('\n');frames.push({type:'text',content:content.slice(0,middle)},{type:'text',content:content.slice(middle)});if(op.reply!=='truncated')frames.push({type:'done'});}
 return{status:200,contentType:'text/event-stream',body:frames.map(f=>'data: '+JSON.stringify(f)+'\r\n\r\n').join('')};
}
async function session(theme:Theme='gold',width=390,height=844,options:Options={}):Promise<Session>{
 if(!browser)throw Error('SC_UI_FIXTURE_BROWSER_REQUIRED');
 const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce',hasTouch:width<768,isMobile:width<768});contexts.add(context);let value:Session|undefined;
 try{
  const page=await context.newPage();page.setDefaultTimeout(1500);
  const s:Session={context,page,options,errors:[],counts:new Map(),handlers:new Set(),pending:new Set(),completed:new Set(),failed:new Set(),refused:new Set(),plannedFailed:new Set(),nativeWaiters:new Set(),gates:[],mounted:false,consumed:new Set(),bodies:[]};value=s;live.add(s);
  context.on('request',r=>s.pending.add(r));context.on('requestfinished',r=>{s.pending.delete(r);s.completed.add(r);for(const n of s.nativeWaiters)n();});context.on('requestfailed',r=>{s.pending.delete(r);s.failed.add(r);for(const n of s.nativeWaiters)n();});
  page.on('pageerror',e=>s.errors.push(String(e)));page.on('dialog',d=>{s.errors.push('SC_UI_FIXTURE_UNEXPECTED_DIALOG');void d.dismiss().catch(e=>s.errors.push(String(e)));});
  await context.routeWebSocket('**/*',socket=>{s.errors.push('SC_UI_FIXTURE_UNKNOWN_WS');socket.close({code:1008,reason:'Offline fixture'});});
  await context.route('**/*',async route=>{const operation=(async():Promise<void>=>{
   const r=route.request(),u=new URL(r.url()),h=r.headers(),key=keyOf(r);if(u.origin!==ORIGIN||u.username||u.password||h.authorization||h.cookie||h['x-api-key']||h['api-key']||h['idempotency-key'])throw Error('SC_UI_FIXTURE_HTTP_BOUNDARY');
   const count=(s.counts.get(key)??0)+1;s.counts.set(key,count);
   if(r.method()==='GET'&&r.postData()===null){
    if(key==='GET /'&&r.isNavigationRequest()&&count===1){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="height:100%;width:100%;position:relative"></div></body></html>'});return;}
    if(options.surface==='chat'&&count<=2){
     if(key==='GET /api/models?type=chat'){await route.fulfill({json:{success:true,models:MODEL_FIXTURE.map(m=>({id:m.id,name:m.displayName,providerId:m.providerId})),providers:MODEL_FIXTURE.map(m=>({id:m.providerId,name:m.providerName,displayName:m.providerName}))}});return;}
     if(key==='GET /api/models?type=image'){await route.fulfill({json:{success:true,models:[],providers:[]}});return;}
     if(key==='GET /api/user-data/sync?key=projects'){await route.fulfill({json:{success:true,key:'projects',value:[]}});return;}
     if(key==='GET /api/simple-chat/memory'){await route.fulfill({json:{memories:[]}});return;}
    }
   }
   if(r.method()==='POST'&&!u.search&&/^application\/json(?:;|$)/.test(h['content-type']??'')&&(u.pathname==='/api/optimize-prompt'||u.pathname==='/api/simple-chat/chat')){
    const body:unknown=JSON.parse(r.postData()??'null');if(!body||typeof body!=='object'||Array.isArray(body))throw Error('SC_UI_FIXTURE_BODY');const b=body as Record<string,unknown>;
    let expected=-1,modelIndex=-1;
    if(u.pathname==='/api/optimize-prompt'){
     if(JSON.stringify(Object.keys(b).sort())!==JSON.stringify(['mode','prompt'])||b.prompt!==QUESTION||!['enhance','expand','simplify'].includes(String(b.mode)))throw Error('SC_UI_FIXTURE_OPTIMIZE_BODY');
     expected=(options.ops??[]).findIndex((op,i)=>!s.consumed.has(i)&&op.kind==='optimize'&&(op.mode??'enhance')===b.mode);
    }else{
     modelIndex=MODEL_FIXTURE.findIndex(m=>m.id===b.model&&m.providerId===b.providerId);
     const legacy=JSON.stringify(Object.keys(b).sort())===JSON.stringify(['history','message','model','providerId'])&&b.message===QUESTION&&Array.isArray(b.history)&&b.history.length===0;
     const current=JSON.stringify(Object.keys(b).sort())===JSON.stringify(['messages','model','providerId'])&&JSON.stringify(b.messages)===JSON.stringify([{role:'user',content:QUESTION}]);
     if(modelIndex<0||(!legacy&&!current))throw Error('SC_UI_FIXTURE_COMPARE_BODY');
     expected=(options.ops??[]).findIndex((op,i)=>!s.consumed.has(i)&&op.kind==='compare'&&op.key===modelKey(modelIndex));
    }
    if(expected<0)throw Error('SC_UI_FIXTURE_UNPROMISED_POST');const op=options.ops![expected];s.consumed.add(expected);s.bodies.push({path:u.pathname,body:b});
    if(op.hold){const g=gate();s.gates.push(g);await g.wait;}
    if(op.reply==='network'){s.plannedFailed.add(r);await route.abort('failed');return;}
    await route.fulfill(replyBody(op,modelIndex));return;
   }
   throw Error('SC_UI_FIXTURE_UNKNOWN_HTTP '+key);
  })().catch(async e=>{s.errors.push(String(e));s.refused.add(route.request());await route.abort('blockedbyclient');});s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);}});
  await page.goto(ORIGIN);await page.addScriptTag({content:bundle});await page.evaluate(({theme,options})=>(window as unknown as FixtureWindow).scUi.mount(theme,options),{theme,options});s.mounted=true;
  await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===(t==='mono'?'light':'dark'),theme,{timeout:1500});
  if(options.surface==='chat'){await page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true}).waitFor();await nativeRequestsFinished(s);}
  else await page.getByRole('heading',{name:options.surface==='compare'?'多模型对比':'提示词优化器',exact:true}).waitFor();await settle(page);return s;
 }catch(e){try{if(value)await dispose(value);else{await context.close();contexts.delete(context);}}catch(cleanup){throw new AggregateError([e,cleanup],'SC_UI_FIXTURE_BOOTSTRAP');}throw e;}
}
async function nativeRequestsFinished(s:Session):Promise<void>{let notify:(()=>void)|undefined;try{await bounded('native requests',()=>new Promise<void>(resolve=>{notify=()=>{if(!s.pending.size)resolve();};s.nativeWaiters.add(notify);notify();}));}finally{if(notify)s.nativeWaiters.delete(notify);}}
async function dispose(s:Session,refusal?:'http'|'websocket',cleanupProbe?:()=>void):Promise<void>{
 const failures:string[]=[];try{if(s.mounted)await bounded('unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.unmount()));cleanupProbe?.();}catch(e){failures.push(String(e));}for(const g of s.gates)g.release();
 try{await bounded('routes',()=>Promise.all([...s.handlers]));await nativeRequestsFinished(s);await bounded('final routes',()=>Promise.all([...s.handlers]));}catch(e){failures.push(String(e));}const unresolved=s.pending.size!==0||s.handlers.size!==0;
 try{await s.context.close();contexts.delete(s.context);live.delete(s);}catch(e){failures.push(String(e));}
 const startup=['GET /'];if(s.options.surface==='chat')startup.push('GET /api/models?type=chat','GET /api/models?type=image','GET /api/user-data/sync?key=projects','GET /api/simple-chat/memory');
 const posts=(s.options.ops??[]).map(o=>'POST '+(o.kind==='optimize'?'/api/optimize-prompt':'/api/simple-chat/chat'));const required=[...new Set([...startup,...posts,...(refusal==='http'?['GET /unexpected']:[])])];
 if(s.consumed.size!==(s.options.ops?.length??0)||JSON.stringify([...s.counts.keys()].sort())!==JSON.stringify(required.sort())||startup.some(k=>(s.counts.get(k)??0)<1||(s.counts.get(k)??0)>(k==='GET /'?1:2))||posts.some(k=>s.counts.get(k)!==posts.filter(x=>x===k).length))throw Error('SC_UI_FIXTURE_REQUEST_VALIDATION');
 const expectedNetwork=(s.options.ops??[]).filter(o=>o.reply==='network').map(o=>'POST '+(o.kind==='optimize'?'/api/optimize-prompt':'/api/simple-chat/chat'));
 if(JSON.stringify([...s.plannedFailed].map(keyOf).sort())!==JSON.stringify(expectedNetwork.sort()))throw Error('SC_UI_FIXTURE_NATIVE_ABORT_CONTRACT');
 const expectedFailed=new Set(s.plannedFailed);if(refusal==='http'){if(s.refused.size!==1||keyOf([...s.refused][0])!=='GET /unexpected')throw Error('SC_UI_FIXTURE_REFUSAL_CONTRACT');expectedFailed.add([...s.refused][0]);}else if(s.refused.size)throw Error('SC_UI_FIXTURE_UNEXPECTED_REFUSAL');
 const completedByKey=new Map<string,number>();for(const r of s.completed)completedByKey.set(keyOf(r),(completedByKey.get(keyOf(r))??0)+1);const failedByKey=new Map<string,number>();for(const r of expectedFailed)failedByKey.set(keyOf(r),(failedByKey.get(keyOf(r))??0)+1);
 if(unresolved||s.failed.size!==expectedFailed.size||[...s.failed].some(r=>!expectedFailed.has(r))||[...s.counts].some(([k,n])=>(completedByKey.get(k)??0)+(failedByKey.get(k)??0)!==n))throw Error('SC_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
 if(failures.length)throw Error('SC_UI_FIXTURE_CLEANUP_FAILURE: '+failures.join('; '));if(refusal){const expected=refusal==='http'?'Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_UNKNOWN_WS';if(s.errors.length!==1||s.errors[0]!==expected)throw Error('SC_UI_FIXTURE_UNEXPECTED_FAILURES: '+s.errors.join('; '));}if(s.errors.length)throw Error('SC_UI_FIXTURE_INFRASTRUCTURE: '+s.errors.join('; '));
}
async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'SC_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}
async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/simple-chat-model-tools-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('SC_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}
async function panelBounds(panel:Locator):Promise<void>{const r=await panel.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,leak:e.scrollWidth-e.clientWidth};});console.log('SC_UI_PANEL_BOUNDS',JSON.stringify(r));expect(r.left,'panel left inside viewport').toBeGreaterThanOrEqual(0);expect(r.top,'panel top inside viewport').toBeGreaterThanOrEqual(0);expect(r.right,'panel right inside viewport').toBeLessThanOrEqual(r.w);expect(r.bottom,'panel bottom inside viewport').toBeLessThanOrEqual(r.h);expect(r.leak,'panel has no horizontal leak').toBeLessThanOrEqual(1);}
async function reveal(s:Session,control:Locator):Promise<void>{
  for(let i=0;i<12;i++){
    const g=await control.evaluate(e=>{const r=e.getBoundingClientRect();let top=0,bottom=innerHeight;let scroll:DOMRect|null=null;for(let p=e.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),st=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(st.overflowY)){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}if(!scroll&&/auto|scroll/.test(st.overflowY)&&p.scrollHeight>p.clientHeight)scroll=b;}return {top:r.top,bottom:r.bottom,clipTop:top,clipBottom:bottom,scroll:scroll?{x:scroll.x,y:scroll.y,width:scroll.width,height:scroll.height}:null};});
    if(g.top>=g.clipTop&&g.bottom<=g.clipBottom)return;
    if(!g.scroll)throw Error('SC_UI_FIXTURE_NO_SCROLL_SURFACE');
    await s.page.mouse.move(g.scroll.x+g.scroll.width/2,Math.max(g.clipTop+2,Math.min(g.clipBottom-2,g.scroll.y+g.scroll.height/2)));
    await s.page.mouse.wheel(0,g.top<g.clipTop?g.top-g.clipTop-12:g.bottom-g.clipBottom+12);await settle(s.page);
  }
  throw Error('SC_UI_FIXTURE_NATIVE_SCROLL_DID_NOT_CONVERGE');
}
async function click(s:Session,control:Locator):Promise<void>{await reveal(s,control);expect(await control.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'native hit').toBe(true);await control.click();await settle(s.page);}


const panel=(s:Session,surface:'optimizer'|'compare'):Locator=>s.page.getByRole('heading',{name:surface==='optimizer'?'提示词优化器':'多模型对比',exact:true}).locator(surface==='optimizer'?'../../..':'../..');
const input=(p:Locator,surface:'optimizer'|'compare'):Locator=>p.getByPlaceholder(surface==='optimizer'?'输入要优化的提示词…':'输入要对比的问题…',{exact:true});
const closeControl=(p:Locator):Locator=>p.locator(':scope > div').first().getByRole('button').last();
const modeControl=(p:Locator,mode:'enhance'|'expand'|'simplify'):Locator=>p.getByRole('button',{name:new RegExp('^'+({enhance:'增强',expand:'扩展',simplify:'精简'}[mode]))});
const modelControl=(p:Locator,i:number):Locator=>p.getByRole('button').filter({hasText:MODEL_FIXTURE[i].displayName});
async function submit(s:Session,surface:'optimizer'|'compare'):Promise<Locator>{const p=panel(s,surface);await reveal(s,input(p,surface));await input(p,surface).fill(QUESTION);await click(s,p.getByRole('button',{name:surface==='optimizer'?'开始优化':'对比',exact:true}));return p;}
const compareOps=(count=2,reply:Reply='ok',hold=false):Operation[]=>Array.from({length:count},(_,i)=>({kind:'compare' as const,key:modelKey(i),reply,hold}));
async function awaitUi(s:Session):Promise<void>{await nativeRequestsFinished(s);await settle(s.page);}
const applied=(s:Session):Promise<string[]>=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state.applied);

describe('model tools layout',()=>{
 it.each((['optimizer','compare'] as const).flatMap(surface=>THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({surface,theme,width,height})))))('$surface $theme $width x $height keeps every action reachable without horizontal leakage',async({surface,theme,width,height})=>{await withSession(theme,width,height,{surface},async s=>{const p=panel(s,surface);await capture(s,surface+'-'+theme+'-'+width+'x'+height);await panelBounds(p);for(const b of await p.getByRole('button').all()){await reveal(s,b);await target(b);}expect(await input(p,surface).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'model tools input font').toBeGreaterThanOrEqual(16);});},25000);
});
describe('model tools semantics',()=>{
 it.each((['optimizer','compare'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme names its close and input and exposes selected options',async({surface,theme})=>{await withSession(theme,390,844,{surface},async s=>{const p=panel(s,surface);expect(await p.getByRole('button',{name:surface==='optimizer'?'关闭提示词优化器':'关闭多模型对比',exact:true}).count(),'model tools named close').toBe(1);expect(await p.getByRole('textbox',{name:surface==='optimizer'?'原始提示词':'对比问题',exact:true}).count(),'model tools named input').toBe(1);if(surface==='optimizer'){expect(await modeControl(p,'enhance').getAttribute('aria-pressed'),'model tools selected mode').toBe('true');await click(s,modeControl(p,'simplify'));expect(await modeControl(p,'simplify').getAttribute('aria-pressed')).toBe('true');expect(await modeControl(p,'enhance').getAttribute('aria-pressed')).toBe('false');}else{expect(await modelControl(p,0).getAttribute('aria-pressed'),'model tools selected model').toBe('true');expect(await modelControl(p,2).getAttribute('aria-pressed')).toBe('false');await click(s,modelControl(p,2));expect(await modelControl(p,2).getAttribute('aria-pressed')).toBe('true');}});},25000);
});
describe('model tools optimizer modes',()=>{
 it.each(THEMES.flatMap(theme=>(['enhance','expand','simplify'] as const).map(mode=>({theme,mode}))))('$theme $mode applies exactly the successful returned document',async({theme,mode})=>{await withSession(theme,390,844,{surface:'optimizer',ops:[{kind:'optimize',mode}]},async s=>{let p=panel(s,'optimizer');await click(s,modeControl(p,mode));p=await submit(s,'optimizer');await awaitUi(s);expect(await p.getByText(ANSWER,{exact:true}).count(),'optimizer complete result').toBe(1);await click(s,p.getByRole('button',{name:'应用结果',exact:true}));expect(await applied(s)).toEqual([ANSWER]);expect(await s.page.getByRole('heading',{name:'提示词优化器',exact:true}).count()).toBe(0);});},25000);
});
describe('model tools optimizer errors',()=>{
 it.each(THEMES.flatMap(theme=>(['http','network','invalid-json','invalid-object','empty'] as const).map(reply=>({theme,reply}))))('$theme $reply keeps the draft and shows an actionable failure without applying anything',async({theme,reply})=>{await withSession(theme,390,844,{surface:'optimizer',ops:[{kind:'optimize',reply}]},async s=>{const p=await submit(s,'optimizer');await awaitUi(s);expect(await p.getByRole('alert').count(),'optimizer visible failure').toBe(1);expect(await input(p,'optimizer').inputValue(),'optimizer rejected draft remains').toBe(QUESTION);expect(await p.getByRole('button',{name:'应用结果',exact:true}).count(),'optimizer rejected response has no apply').toBe(0);expect(await applied(s)).toEqual([]);expect(s.consumed.size,'optimizer no automatic retry').toBe(1);});},25000);
});
describe('model tools optimizer pending',()=>{
 it.each(THEMES)('%s prevents duplicate submits and does not toast a late rejection into a reopened panel',async theme=>{await withSession(theme,390,844,{surface:'optimizer',ops:[{kind:'optimize',reply:'http',hold:true}]},async s=>{let p=await submit(s,'optimizer');await expect.poll(()=>s.gates.length,{timeout:1500}).toBe(1);expect(await input(p,'optimizer').isDisabled(),'optimizer pending draft disabled').toBe(true);for(const mode of ['enhance','expand','simplify'] as const)expect(await modeControl(p,mode).isDisabled(),'optimizer pending mode disabled').toBe(true);await s.page.keyboard.press('Enter');expect(s.consumed.size).toBe(1);await click(s,closeControl(p));await click(s,s.page.getByRole('button',{name:'重新打开',exact:true}));p=panel(s,'optimizer');await input(p,'optimizer').fill('新面板草稿');s.gates[0].release();await awaitUi(s);expect(await input(p,'optimizer').inputValue()).toBe('新面板草稿');expect(await p.getByRole('alert').count(),'optimizer old rejection is not a new panel error').toBe(0);expect(await s.page.locator('[data-sonner-toast]').count(),'optimizer no late toast').toBe(0);});},25000);
});
describe('model tools compare payload',()=>{
 it.each(THEMES)('%s sends the current messages schema with each exact provider and model',async theme=>{await withSession(theme,390,844,{surface:'compare',ops:compareOps()},async s=>{await submit(s,'compare');await awaitUi(s);expect(s.bodies.map(x=>x.body).sort((a,b)=>String(a.providerId).localeCompare(String(b.providerId))),'compare exact current request').toEqual([{messages:[{role:'user',content:QUESTION}],model:'shared-model',providerId:'provider-a'},{messages:[{role:'user',content:QUESTION}],model:'shared-model',providerId:'provider-b'}]);});},25000);
});
describe('model tools compare stream',()=>{
 it.each(THEMES)('%s reads current SSE text frames and labels same-model providers independently',async theme=>{await withSession(theme,390,844,{surface:'compare',ops:compareOps()},async s=>{const p=await submit(s,'compare');await awaitUi(s);expect(await p.getByText(modelAnswer(0),{exact:true}).count(),'compare streamed first result').toBe(1);expect(await p.getByText(modelAnswer(1),{exact:true}).count(),'compare streamed second result').toBe(1);expect(await p.getByRole('alert').count()).toBe(0);for(const i of [0,1])expect(await p.locator('span').filter({hasText:MODEL_FIXTURE[i].displayName}).filter({hasText:MODEL_FIXTURE[i].providerName}).evaluateAll(es=>es.filter(e=>!e.closest('button')).length),'compare frozen provider label').toBe(1);await s.context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});await click(s,p.getByTitle('复制回答',{exact:true}).nth(1));const copied=await s.page.evaluate(()=>navigator.clipboard.readText());expect(copied).toBe(process.platform==='win32'?modelAnswer(1).replace(/\n/g,'\r\n'):modelAnswer(1));});},25000);
});
describe('model tools compare results layout',()=>{
 it.each(THEMES.flatMap(theme=>[2,3].flatMap(count=>[[320,640],[640,320]].map(([width,height])=>({theme,count,width,height})))) )('$theme $count results $width x $height remain readable with native scrolling and copying controls',async({theme,count,width,height})=>{await withSession(theme,width,height,{surface:'compare',ops:compareOps(count)},async s=>{let p=panel(s,'compare');if(count===3)await click(s,modelControl(p,2));p=await submit(s,'compare');await awaitUi(s);expect(await p.getByText(modelAnswer(0),{exact:true}).count(),'compare result exists before geometry').toBe(1);await panelBounds(p);const cards=p.getByTitle('复制回答',{exact:true});expect(await cards.count()).toBe(count);for(const b of await cards.all()){await reveal(s,b);await target(b);}for(let i=0;i<count;i++){const text=p.getByText(modelAnswer(i),{exact:true});expect(await text.evaluate(e=>e.getBoundingClientRect().width),'compare readable result width').toBeGreaterThanOrEqual(220);expect(await text.evaluate(e=>e.scrollWidth-e.clientWidth),'compare result no horizontal leak').toBeLessThanOrEqual(1);}await capture(s,'compare-results-'+theme+'-'+count+'-'+width+'x'+height);});},25000);
});
describe('model tools compare errors',()=>{
 it.each(['http','network','sse-error','truncated','malformed','json'] as const)('%s is a visible per-model failure while the other model remains usable',async reply=>{await withSession(reply==='http'?'gold':'mono',390,844,{surface:'compare',ops:[{kind:'compare',key:modelKey(0),reply},{kind:'compare',key:modelKey(1)}]},async s=>{const p=await submit(s,'compare');await awaitUi(s);expect(await p.getByRole('alert').count(),'compare per-model visible failure').toBe(1);expect(await p.getByText(modelAnswer(1),{exact:true}).count(),'compare unaffected successful result').toBe(1);expect(await p.getByTitle('复制回答',{exact:true}).count(),'compare failed result cannot copy as success').toBe(1);if(reply==='sse-error')expect(await p.getByRole('alert').innerText()).toContain('合成流式服务拒绝');if(reply==='http')expect(await p.getByRole('alert').innerText()).toContain('合成服务拒绝');expect(s.consumed.size,'compare no automatic retry').toBe(2);});},25000);
});
describe('model tools compare pending',()=>{
 it.each(THEMES)('%s keeps model selection and input frozen while the original pair is pending',async theme=>{await withSession(theme,390,844,{surface:'compare',ops:compareOps(2,'ok',true)},async s=>{const p=await submit(s,'compare');await expect.poll(()=>s.gates.length,{timeout:1500}).toBe(2);expect(await input(p,'compare').isDisabled(),'compare pending draft disabled').toBe(true);for(const i of [0,1,2])expect(await modelControl(p,i).isDisabled(),'compare pending models disabled').toBe(true);await s.page.keyboard.press('Enter');expect(s.consumed.size).toBe(2);for(const g of s.gates)g.release();await awaitUi(s);expect(await p.getByText(modelAnswer(0),{exact:true}).count()).toBe(1);expect(await p.getByText(modelAnswer(1),{exact:true}).count()).toBe(1);});},25000);
});
describe('model tools compare unavailable',()=>{
 it.each(THEMES.flatMap(theme=>[0,1].map(modelCount=>({theme,modelCount}))))('$theme $modelCount models cannot submit or emit a request',async({theme,modelCount})=>{await withSession(theme,390,844,{surface:'compare',modelCount},async s=>{const p=panel(s,'compare');await input(p,'compare').fill(QUESTION);expect(await p.getByRole('button',{name:'对比',exact:true}).isDisabled()).toBe(true);expect(s.consumed.size).toBe(0);});},25000);
});
describe('model tools parent integration',()=>{
 it.each(THEMES)('%s applies an optimized draft to the real ChatArea and receives provider labels from its configured model list',async theme=>{await withSession(theme,390,844,{surface:'chat',ops:[{kind:'optimize',mode:'simplify'}]},async s=>{const composer=s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true});await composer.fill(QUESTION);await composer.focus();await s.page.keyboard.press('Control+Shift+P');let p=panel(s,'optimizer');await click(s,modeControl(p,'simplify'));await click(s,p.getByRole('button',{name:'开始优化',exact:true}));await awaitUi(s);await click(s,p.getByRole('button',{name:'应用结果',exact:true}));expect(await composer.inputValue()).toBe(ANSWER);await composer.focus();await s.page.keyboard.press('Control+m');p=panel(s,'compare');for(const i of [0,1,2])expect(await modelControl(p,i).innerText(),'compare parent supplies vendor name').toContain(MODEL_FIXTURE[i].providerName);await s.page.keyboard.press('Escape');expect(await s.page.getByRole('heading',{name:'多模型对比',exact:true}).count()).toBe(0);expect(await composer.evaluate(e=>e===document.activeElement)).toBe(true);});},25000);
});
describe('model tools rotation and focus',()=>{
 it.each((['optimizer','compare'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme preserves the same draft and keeps keyboard navigation inside until Escape',async({surface,theme})=>{await withSession(theme,390,844,{surface},async s=>{const p=panel(s,surface),field=input(p,surface);await field.fill('保持同一草稿');for(const[width,height]of [[640,320],[1440,900],[320,640]]){await s.page.setViewportSize({width,height});await settle(s.page);await panelBounds(p);expect(await field.inputValue()).toBe('保持同一草稿');}await field.focus();for(let i=0;i<8;i++){await s.page.keyboard.press('Tab');expect(await p.evaluate(e=>e.contains(document.activeElement)),'model tools focus stays inside').toBe(true);}await s.page.keyboard.press('Escape');expect(await s.page.getByRole('heading',{name:surface==='optimizer'?'提示词优化器':'多模型对比',exact:true}).count()).toBe(0);});},25000);
});
describe('model tools contrast',()=>{
 it.each((['optimizer','compare'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme keeps input, descriptions and enabled primary actions readable',async({surface,theme})=>{await withSession(theme,390,844,{surface},async s=>{const p=panel(s,surface),field=input(p,surface);await field.fill(QUESTION);const primary=p.getByRole('button',{name:surface==='optimizer'?'开始优化':'对比',exact:true});await expect.poll(()=>primary.evaluate(e=>Number(getComputedStyle(e).opacity)),{timeout:1500}).toBe(1);const samples:Array<{name:string;ratio:number}>=[];for(const el of [field,primary,...await p.locator('label').all()]){await reveal(s,el);samples.push({name:await el.evaluate(e=>e.textContent||e.getAttribute('placeholder')||''),ratio:await textContrast(el,await el.evaluate(e=>e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))});}if(surface==='optimizer')for(const el of await modeControl(p,'simplify').locator('div').all())samples.push({name:await el.innerText(),ratio:await textContrast(el)});console.log('SC_MODEL_TOOLS_CONTRAST',JSON.stringify({surface,theme,samples}));expect(Math.min(...samples.map(x=>x.ratio)),'model tools text contrast').toBeGreaterThanOrEqual(4.5);});},25000);
});
describe('model tools fixture boundary',()=>{
  it('rejects a missing promised POST instead of passing an unsubmitted operation',async()=>{const s=await session('gold',390,844,{surface:'optimizer',ops:[{kind:'optimize'}]});await expect(dispose(s)).rejects.toThrow('SC_UI_FIXTURE_REQUEST_VALIDATION');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{const s=await session('gold',390,844,{surface:'optimizer'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}},25000);
  it.each(['http','websocket'] as const)('preserves a cleanup failure alongside expected %s refusal',async transport=>{const s=await session('gold',390,844,{surface:'optimizer'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});


describe('model tools optimizer late',()=>{
 it.each(THEMES)('%s does not publish an old request rejection after closing and opening a fresh editor',async theme=>{await withSession(theme,390,844,{surface:'optimizer',ops:[{kind:'optimize',reply:'http',hold:true}]},async s=>{let p=await submit(s,'optimizer');await expect.poll(()=>s.gates.length,{timeout:1500}).toBe(1);await click(s,closeControl(p));await click(s,s.page.getByRole('button',{name:'重新打开',exact:true}));p=panel(s,'optimizer');await input(p,'optimizer').fill('新面板草稿');s.gates[0].release();await awaitUi(s);expect(await input(p,'optimizer').inputValue()).toBe('新面板草稿');expect(await p.getByRole('alert').count()).toBe(0);expect(await s.page.locator('[data-sonner-toast]').count(),'optimizer no late toast').toBe(0);});},25000);
});
