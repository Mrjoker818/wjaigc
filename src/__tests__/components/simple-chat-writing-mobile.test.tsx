// @vitest-environment node
// Shipped Sidebar, ChatArea, MemoryPanel, theme provider and full CSS/import graph.
// Synthetic .invalid HTTP only. No real account, sync service, model or database.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Request } from '@playwright/test';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Theme = 'gold' | 'mono';
interface Operation { method: 'POST' | 'DELETE'; status?: number; network?: boolean; hold?: boolean; reply?: 'invalid-json' | 'invalid-object' }
interface Options { surface?: 'chat' | 'sidebar'; populated?: boolean; touch?: boolean; ops?: Operation[] }
interface Gate { wait: Promise<void>; release(): void }
interface FixtureWindow extends Window { scUi: { mount(theme: Theme, options: Options): void; unmount(): void; state: { disposed: boolean; actions: string[]; projectWrites: unknown[] } } }
interface Session {
  context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>;
  pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; plannedFailed: Set<Request>;
  nativeWaiters: Set<() => void>; gates: Gate[]; mounted: boolean; consumed: number;
}
const ORIGIN = 'https://simple-chat-writing-mobile.invalid';
const THEMES: Theme[] = ['gold', 'mono'];
const MEMORY_TEXT = '移动端合成记忆';
const MEMORY_ID = 'memory-seed-1';
const ENTRY = String.raw`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Sidebar from '@/components/simple-chat/sidebar';
import ChatArea from '@/components/simple-chat/chat-area';
import {Providers} from '@/app/simple-chat/providers';
import {Toaster} from 'sonner';
import type {SimpleChatProject,SimpleChatTask} from '@/components/simple-chat/simple-chat-types';
const seed:SimpleChatProject[]=[{id:'project-one',name:'手机项目一很长的项目名称用于检查边界',createdAt:1,updatedAt:1,agents:[],knowledgeItems:[],instructions:{projectBackground:'原背景',userPreference:'原偏好',outputFormat:'原格式',styleRules:'原风格',forbiddenRules:'原约束',language:'zh-CN'},tasks:Array.from({length:10},(_,i)=>({id:'task-'+i,projectId:'project-one',name:'对话'+i+'很长的名称检查按钮是否可见',messages:[],model:'',providerId:'',createdAt:1,updatedAt:1}))},{id:'project-two',name:'手机项目二',createdAt:1,updatedAt:1,agents:[],knowledgeItems:[],tasks:[]}];
const user={id:'synthetic-mobile-user',name:'仅本地界面合成用户',role:'user' as const,status:'active' as const,productType:'chat' as const,createdAt:1,updatedAt:1};
const root=createRoot(document.getElementById('fixture-root')!);
const state={disposed:false,actions:[] as string[],projectWrites:[] as unknown[]};let mounted=false;
function Entry({options}:{options:{surface?:'chat'|'sidebar';populated?:boolean}}){
 const [projects,setProjects]=useState(seed),[active,setActive]=useState('project-one'),[taskId,setTaskId]=useState<string|null>('task-0'),[open,setOpen]=useState(true);
 const project=projects[0],task={...project.tasks[0],messages:options.populated?[{id:'message-artifacts',role:'assistant' as const,content:'合成文档列表',createdAt:1,artifacts:Array.from({length:12},(_,i)=>({id:'artifact-'+i,type:'code' as const,title:'文档 '+i+' '+('long-title'.repeat(10)),content:'https://artifact.invalid/'+('long-content'.repeat(30)),language:'text'}))}]:[]};
 const record=(...a:string[])=>state.actions.push(JSON.stringify(a));
 const updateTask=(value:SimpleChatTask)=>setProjects(p=>p.map(x=>x.id===value.projectId?{...x,tasks:x.tasks.map(t=>t.id===value.id?value:t)}:x));
 return <div className="flex h-full w-full min-w-0 overflow-hidden">
 {options.surface==='sidebar'?<Sidebar user={user} projects={projects} activeProjectId={active} activeTaskId={taskId} sidebarOpen={open}
 onToggleSidebar={()=>{record('toggle');setOpen(v=>!v);}}
 onSelectProject={id=>{record('project',id);setActive(id);setTaskId(null);}}
 onSelectTask={id=>{record('task',id);setTaskId(id);}}
 onCreateProject={()=>record('create-project')} onCreateTask={id=>record('create-task',id)}
 onDeleteProject={id=>record('delete-project',id)} onDeleteTask={(id,tid)=>record('delete-task',id,tid)}
 onRenameProject={(id,name)=>{record('rename-project',id,name);setProjects(p=>p.map(x=>x.id===id?{...x,name}:x));}}
 onRenameTask={(id,tid,name)=>{record('rename-task',id,tid,name);setProjects(p=>p.map(x=>x.id===id?{...x,tasks:x.tasks.map(t=>t.id===tid?{...t,name}:t)}:x));}}
 onLogout={()=>record('logout')}/>:<ChatArea user={user} project={project} task={task}
 onUpdateTask={updateTask} onPersistTask={async()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_PERSIST');}}
 onUpdateProject={value=>{state.projectWrites.push(JSON.parse(JSON.stringify(value)));setProjects(p=>p.map(x=>x.id===value.id?value:x));}}
 onCreateTask={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_CHAT_TASK');}} onSelectTask={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_CHAT_SELECT');}}
 onUpdateAgent={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_AGENT');}} onDeleteAgent={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_AGENT');}}
 onSkillToAgent={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_SKILL');}} onLogout={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_LOGOUT');}}
 onBackToWorkspace={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_NAVIGATION');}} sidebarOpen={false} onToggleSidebar={()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_SIDEBAR');}}/>}
 <Toaster/></div>;
}
Object.assign(window,{scUi:{state,mount(theme:'gold'|'mono',options:{surface?:'chat'|'sidebar'}){if(mounted||state.disposed)throw Error('SC_UI_FIXTURE_REMOUNT');mounted=true;localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');root.render(<Providers><Entry options={options}/></Providers>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});
`;
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-chat-writing-mobile-entry.tsx' },
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

function gate(): Gate { let release = (): void => {}; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }
function memorySeed(populated = false): Array<{id:string;content:string;category:string;createdAt:number}> {
  return Array.from({length:populated?20:1},(_,i)=>({id:i===0?MEMORY_ID:'memory-'+i,content:'原有记忆 '+i+' https://example.invalid/'+('long-segment'.repeat(8)),category:['style','preference','background','other'][i%4],createdAt:1}));
}
async function session(theme: Theme = 'gold', width = 390, height = 844, options: Options = {}): Promise<Session> {
  if (!browser) throw Error('SC_UI_FIXTURE_BROWSER_REQUIRED');
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce',hasTouch:options.touch??width<768,isMobile:width<768});contexts.add(context);
  let value:Session|undefined;
  try {
    const page=await context.newPage();page.setDefaultTimeout(1500);
    const s:Session={context,page,options,errors:[],counts:new Map(),handlers:new Set(),pending:new Set(),completed:new Set(),failed:new Set(),refused:new Set(),plannedFailed:new Set(),nativeWaiters:new Set(),gates:[],mounted:false,consumed:0};value=s;live.add(s);
    context.on('request',r=>s.pending.add(r));
    context.on('requestfinished',r=>{s.pending.delete(r);s.completed.add(r);for(const notify of s.nativeWaiters)notify();});
    context.on('requestfailed',r=>{s.pending.delete(r);s.failed.add(r);for(const notify of s.nativeWaiters)notify();});
    page.on('pageerror',e=>s.errors.push(String(e)));
    page.on('dialog',d=>{s.errors.push('SC_UI_FIXTURE_UNEXPECTED_DIALOG');void d.dismiss().catch(e=>s.errors.push(String(e)));});
    await context.routeWebSocket('**/*',socket=>{s.errors.push('SC_UI_FIXTURE_UNKNOWN_WS');socket.close({code:1008,reason:'Offline fixture'});});
    await context.route('**/*',async route=>{
      const operation=(async():Promise<void>=>{
        const request=route.request(),url=new URL(request.url()),headers=request.headers(),key=request.method()+' '+url.pathname+url.search;
        if(url.origin!==ORIGIN||url.username||url.password||headers.authorization||headers.cookie||headers['x-api-key']||headers['api-key']||headers['idempotency-key'])throw Error('SC_UI_FIXTURE_HTTP_BOUNDARY');
        const count=(s.counts.get(key)??0)+1;s.counts.set(key,count);
        if(request.method()==='GET'&&request.postData()===null){
          if(key==='GET /'&&request.isNavigationRequest()&&count===1){await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root" style="height:100%;width:100%;position:relative"></div></body></html>`});return;}
          // The actual ThemeProvider initially mounts a hidden child, then its
          // context child. Only these read-only startup GETs may occur twice.
          if(options.surface!=='sidebar'&&count<=2){
            if(key==='GET /api/models?type=chat'||key==='GET /api/models?type=image'){await route.fulfill({json:{success:true,models:[],providers:[]}});return;}
            if(key==='GET /api/user-data/sync?key=projects'){await route.fulfill({json:{success:true,key:'projects',value:[]}});return;}
            if(key==='GET /api/simple-chat/memory'){await route.fulfill({json:{memories:memorySeed(options.populated)}});return;}
          }
        }
        const expected=options.ops?.[s.consumed];
        if(expected&&request.method()===expected.method&&url.pathname==='/api/simple-chat/memory'){
          if(expected.method==='POST'){
            if(url.search||!/^application\/json(?:;|$)/.test(headers['content-type']??''))throw Error('SC_UI_FIXTURE_MUTATION_TYPE');
            const body:unknown=JSON.parse(request.postData()??'null');
            if(!body||typeof body!=='object'||JSON.stringify(Object.keys(body).sort())!==JSON.stringify(['category','content'])||(body as Record<string,unknown>).content!==MEMORY_TEXT||(body as Record<string,unknown>).category!=='preference')throw Error('SC_UI_FIXTURE_MUTATION_BODY');
          }else if(url.search!=='?id='+MEMORY_ID||request.postData()!==null)throw Error('SC_UI_FIXTURE_DELETE_ID');
          s.consumed++;
          if(expected.hold){const g=gate();s.gates.push(g);await g.wait;}
          if(expected.network){s.plannedFailed.add(request);await route.abort('failed');return;}
          if(expected.reply==='invalid-json'){await route.fulfill({contentType:'application/json',body:'{invalid'});return;}
          if(expected.reply==='invalid-object'){await route.fulfill({json:{unexpected:true}});return;}
          const status=expected.status??200;
          await route.fulfill({status,json:status>=400?{error:'合成服务拒绝'}:expected.method==='POST'?{id:'memory-created',content:MEMORY_TEXT,category:'preference'}:{success:true}});return;
        }
        throw Error('SC_UI_FIXTURE_UNKNOWN_HTTP '+key);
      })().catch(async error=>{s.errors.push(String(error));s.refused.add(route.request());await route.abort('blockedbyclient');});
      s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);}
    });
    await page.goto(ORIGIN);await page.addScriptTag({content:bundle});await page.evaluate(({theme,options})=>(window as unknown as FixtureWindow).scUi.mount(theme,options),{theme,options});s.mounted=true;
    await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===(t==='mono'?'light':'dark'),theme,{timeout:1500});
    if(options.surface==='sidebar')await page.getByRole('heading',{name:'智能对话',exact:true}).waitFor();
    else{await page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true}).waitFor();await nativeRequestsFinished(s);}
    await settle(page);return s;
  }catch(error){try{if(value)await dispose(value);else{await context.close();contexts.delete(context);}}catch(cleanup){throw new AggregateError([error,cleanup],'SC_UI_FIXTURE_BOOTSTRAP');}throw error;}
}
async function nativeRequestsFinished(s:Session):Promise<void>{let notify:(()=>void)|undefined;try{await bounded('native requests',()=>new Promise<void>(resolve=>{notify=()=>{if(!s.pending.size)resolve();};s.nativeWaiters.add(notify);notify();}));}finally{if(notify)s.nativeWaiters.delete(notify);}}
async function dispose(s:Session,refusal?:'http'|'websocket',cleanupProbe?:()=>void):Promise<void>{
  const failures:string[]=[];
  try{if(s.mounted)await bounded('unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.unmount()));cleanupProbe?.();}catch(e){failures.push(String(e));}
  for(const g of s.gates)g.release();
  try{await bounded('routes',()=>Promise.all([...s.handlers]));await nativeRequestsFinished(s);await bounded('final routes',()=>Promise.all([...s.handlers]));}catch(e){failures.push(String(e));}
  const unresolved=s.pending.size!==0||s.handlers.size!==0;
  try{await s.context.close();contexts.delete(s.context);live.delete(s);}catch(e){failures.push(String(e));}
  const startup=['GET /'];if(s.options.surface!=='sidebar')startup.push('GET /api/models?type=chat','GET /api/models?type=image','GET /api/user-data/sync?key=projects','GET /api/simple-chat/memory');
  const mutationKeys=(s.options.ops??[]).map(o=>o.method+' /api/simple-chat/memory'+(o.method==='DELETE'?'?id='+MEMORY_ID:''));
  const required=[...new Set([...startup,...mutationKeys,...(refusal==='http'?['GET /unexpected']:[])])];
  if(s.consumed!==(s.options.ops?.length??0)||JSON.stringify([...s.counts.keys()].sort())!==JSON.stringify(required.sort())||startup.some(k=>(s.counts.get(k)??0)<1||(s.counts.get(k)??0)>(k==='GET /'?1:2))||mutationKeys.some(k=>s.counts.get(k)!==mutationKeys.filter(x=>x===k).length))throw Error('SC_UI_FIXTURE_REQUEST_VALIDATION');
  const keyOf=(r:Request):string=>r.method()+' '+new URL(r.url()).pathname+new URL(r.url()).search;
  const expectedNetwork=(s.options.ops??[]).filter(o=>o.network).map(o=>o.method+' /api/simple-chat/memory'+(o.method==='DELETE'?'?id='+MEMORY_ID:''));
  if(JSON.stringify([...s.plannedFailed].map(keyOf).sort())!==JSON.stringify(expectedNetwork.sort()))throw Error('SC_UI_FIXTURE_NATIVE_ABORT_CONTRACT');
  const expectedFailed=new Set(s.plannedFailed);
  if(refusal==='http'){if(s.refused.size!==1||keyOf([...s.refused][0])!=='GET /unexpected')throw Error('SC_UI_FIXTURE_REFUSAL_CONTRACT');expectedFailed.add([...s.refused][0]);}else if(s.refused.size)throw Error('SC_UI_FIXTURE_UNEXPECTED_REFUSAL');
  const completedByKey=new Map<string,number>();for(const r of s.completed)completedByKey.set(keyOf(r),(completedByKey.get(keyOf(r))??0)+1);
  const failedByKey=new Map<string,number>();for(const r of expectedFailed)failedByKey.set(keyOf(r),(failedByKey.get(keyOf(r))??0)+1);
  if(unresolved||s.failed.size!==expectedFailed.size||[...s.failed].some(r=>!expectedFailed.has(r))||[...s.counts].some(([k,n])=>(completedByKey.get(k)??0)+(failedByKey.get(k)??0)!==n))throw Error('SC_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
  if(failures.length)throw Error('SC_UI_FIXTURE_CLEANUP_FAILURE: '+failures.join('; '));
  if(refusal){const expected=refusal==='http'?'Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_UNKNOWN_WS';if(s.errors.length!==1||s.errors[0]!==expected)throw Error('SC_UI_FIXTURE_UNEXPECTED_FAILURES: '+s.errors.join('; '));}
  if(s.errors.length)throw Error('SC_UI_FIXTURE_INFRASTRUCTURE: '+s.errors.join('; '));
}
async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'SC_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}
async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/simple-chat-writing-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('SC_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}
async function openEntry(s:Session,name:string):Promise<void>{const settings=s.page.getByRole('button',{name:'更多设置',exact:true});if(await settings.count()&&await settings.getAttribute('aria-expanded')==='false'){await settings.click();await settle(s.page);}await click(s,s.page.getByTitle(name,{exact:true}));}
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

const writing=(s:Session):Locator=>s.page.getByPlaceholder('在这里编辑文案...',{exact:true}).locator('../../..');
const artifacts=(s:Session):Locator=>s.page.getByRole('heading',{name:'Artifacts',exact:true}).locator('../..');
const EDITED='第一段：移动端文案。\n第二段：保存、恢复与导出都应保留这段内容。';
async function openWriting(s:Session):Promise<Locator>{await openEntry(s,'写作画布');await s.page.getByPlaceholder('在这里编辑文案...',{exact:true}).waitFor();return writing(s);}
async function expectControls(s:Session,p:Locator):Promise<void>{for(const button of await p.getByRole('button').all()){if(await button.isVisible()){await reveal(s,button);await target(button);}}}
async function closeWriting(s:Session):Promise<void>{const close=writing(s).getByRole('button',{name:'关闭写作画布',exact:true});expect(await close.count(),'writing named close').toBe(1);await click(s,close);expect(await s.page.getByPlaceholder('在这里编辑文案...',{exact:true}).count()).toBe(0);}

describe('simple writing layout',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps a usable editor and every header control within the viewport',async({theme,width,height})=>{await withSession(theme,width,height,{},async s=>{
  const p=await openWriting(s);await capture(s,theme+'-writing-'+width+'x'+height);await panelBounds(p);
  expect(await p.evaluate(e=>e.getBoundingClientRect().height),'writing panel uses available height').toBeGreaterThanOrEqual(height-24);
  await expectControls(s,p);const field=p.getByPlaceholder('在这里编辑文案...',{exact:true});
  expect(await field.evaluate(e=>e.getBoundingClientRect().height),'writing readable editing height').toBeGreaterThanOrEqual(96);
  expect(await field.evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'writing input font').toBeGreaterThanOrEqual(16);
  expect(await p.getByRole('button',{name:'AI 修改',exact:true}).isDisabled()).toBe(true);
 });},25000);
});
describe('simple writing names',()=>{
 it.each(THEMES)('%s labels the close, editor and AI instruction without relying on icons or placeholders',async theme=>{await withSession(theme,390,844,{},async s=>{
  const p=await openWriting(s);expect(await p.getByRole('button',{name:'关闭写作画布',exact:true}).count(),'writing named close').toBe(1);
  expect(await p.getByRole('textbox',{name:'文案内容',exact:true}).count(),'writing named editor').toBe(1);expect(await p.getByRole('textbox',{name:'AI 修改要求',exact:true}).count(),'writing named instruction').toBe(1);
 });},25000);
});
describe('simple writing history',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height opens readable history without squeezing it into a sliver',async({theme,width,height})=>{await withSession(theme,width,height,{},async s=>{
  const p=await openWriting(s);await click(s,p.getByRole('button',{name:/版本 \(/}));const history=p.getByText('版本历史',{exact:true}).locator('..');await capture(s,theme+'-history-'+width+'x'+height);await panelBounds(history);
  expect(await history.evaluate(e=>e.getBoundingClientRect().width),'writing history readable width').toBeGreaterThanOrEqual(200);
  await target(history.getByRole('button',{name:/初始版本/}));
 });},25000);
});
describe('simple writing artifacts layering',()=>{
 it.each(THEMES.flatMap(theme=>[false,true].map(populated=>({theme,populated}))))('$theme populated=$populated is above the real header and settings and can be closed natively',async({theme,populated})=>{await withSession(theme,320,640,{populated},async s=>{
  await openEntry(s,'Artifacts 文档');const p=artifacts(s);await capture(s,theme+'-artifacts-'+(populated?'filled':'empty'));await panelBounds(p);
  const title=p.getByRole('heading',{name:'Artifacts',exact:true});expect(await title.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'artifact header native hit').toBe(true);
  const close=p.locator(':scope > div').first().getByRole('button');await target(close);await close.click();await settle(s.page);expect(await p.count()).toBe(0);
 });},25000);
});
describe('simple writing artifacts content',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps long populated documents in the panel and reaches its last entry',async({theme,width,height})=>{await withSession(theme,width,height,{populated:true},async s=>{
  await openEntry(s,'Artifacts 文档');const p=artifacts(s),last=p.getByText(/^文档 11 /);await panelBounds(p);
  expect(await p.locator('pre').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)),'artifact long content wraps').toBe(true);
  expect(await p.getByRole('heading',{name:'Artifacts',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'artifact header native hit').toBe(true);await reveal(s,last);expect(await last.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'artifact last entry native hit').toBe(true);
 });},25000);
});
describe('simple writing operations',()=>{
 it.each(THEMES)('%s saves, reopens, copies, exports and restores a version through the real parent without model calls',async theme=>{await withSession(theme,390,844,{},async s=>{
  let p=await openWriting(s);const field=p.getByPlaceholder('在这里编辑文案...',{exact:true});await field.fill(EDITED);
  await click(s,p.getByRole('button',{name:'保存',exact:true}));await closeWriting(s);p=await openWriting(s);expect(await p.getByPlaceholder('在这里编辑文案...',{exact:true}).inputValue()).toBe(EDITED);
  await s.context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});await click(s,p.getByTitle('复制全部',{exact:true}));const copied=await s.page.evaluate(()=>navigator.clipboard.readText());console.log('SC_WRITING_NATIVE_CLIPBOARD',JSON.stringify({platform:process.platform,copied}));expect(copied).toBe(process.platform==='win32'?EDITED.replace(/\n/g,'\r\n'):EDITED);
  const downloaded=s.page.waitForEvent('download');await click(s,p.getByTitle('导出 Markdown',{exact:true}));const download=await downloaded;expect(download.suggestedFilename()).toMatch(/^文案-\d{4}-\d{2}-\d{2}\.md$/);expect(await download.failure()).toBeNull();const stream=await download.createReadStream();if(!stream)throw Error('SC_UI_FIXTURE_DOWNLOAD_STREAM');const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks).toString('utf8')).toBe(EDITED);
  await p.getByPlaceholder('在这里编辑文案...',{exact:true}).fill('稍后被恢复的未保存草稿');await click(s,p.getByRole('button',{name:/版本 \(/}));let history=p.getByText('版本历史',{exact:true}).locator('..');await click(s,history.getByRole('button',{name:/初始版本/}));expect(await p.getByPlaceholder('在这里编辑文案...',{exact:true}).inputValue()).toBe(EDITED);
  await click(s,p.getByRole('button',{name:/版本 \(/}));history=p.getByText('版本历史',{exact:true}).locator('..');await click(s,history.getByRole('button',{name:/恢复前备份/}));expect(await p.getByPlaceholder('在这里编辑文案...',{exact:true}).inputValue()).toBe('稍后被恢复的未保存草稿');await closeWriting(s);
 });},25000);
});
describe('simple writing rotation',()=>{
 it.each(THEMES)('%s preserves the current unsaved document while the same editor changes orientation and desktop size',async theme=>{await withSession(theme,390,844,{},async s=>{
  const p=await openWriting(s),field=p.getByPlaceholder('在这里编辑文案...',{exact:true});await field.fill(EDITED);
  for(const[width,height]of [[640,320],[1440,900],[320,640]]){await s.page.setViewportSize({width,height});await settle(s.page);await panelBounds(p);expect(await field.inputValue()).toBe(EDITED);await target(p.getByRole('button',{name:'关闭写作画布',exact:true}));}
 });},25000);
});
describe('simple writing contrast',()=>{
 it.each(THEMES)('%s keeps the editor placeholder and history text legible in both palettes',async theme=>{await withSession(theme,390,844,{},async s=>{
  const p=await openWriting(s),field=p.getByPlaceholder('在这里编辑文案...',{exact:true});const samples=[{name:'editor placeholder',ratio:await textContrast(field,true)}];expect(samples[0].ratio,'writing text contrast').toBeGreaterThanOrEqual(4.5);await click(s,p.getByRole('button',{name:/版本 \(/}));const history=p.getByText('版本历史',{exact:true}).locator('..');for(const el of await history.locator('div').filter({hasText:/初始版本|版本历史/}).all()){if(await el.evaluate(e=>e.children.length===0)&&await el.isVisible())samples.push({name:await el.innerText(),ratio:await textContrast(el)});}
  console.log('SC_WRITING_CONTRAST',JSON.stringify({theme,samples}));expect(Math.min(...samples.map(x=>x.ratio)),'writing text contrast').toBeGreaterThanOrEqual(4.5);
 });},25000);
});
describe('simple writing fixture boundary',()=>{
  it('rejects a missing promised POST instead of passing an unsubmitted operation',async()=>{const s=await session('gold',390,844,{ops:[{method:'POST'}]});await expect(dispose(s)).rejects.toThrow('SC_UI_FIXTURE_REQUEST_VALIDATION');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{const s=await session('gold',390,844,{surface:'sidebar'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}},25000);
  it.each(['http','websocket'] as const)('preserves a cleanup failure alongside expected %s refusal',async transport=>{const s=await session('gold',390,844,{surface:'sidebar'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});

