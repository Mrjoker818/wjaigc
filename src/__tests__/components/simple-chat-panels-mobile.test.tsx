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
const ORIGIN = 'https://simple-chat-panels-mobile.invalid';
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
function Entry({options}:{options:{surface?:'chat'|'sidebar'}}){
 const [projects,setProjects]=useState(seed),[active,setActive]=useState('project-one'),[taskId,setTaskId]=useState<string|null>('task-0'),[open,setOpen]=useState(true);
 const project=projects[0],task=project.tasks[0];
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-chat-panels-mobile-entry.tsx' },
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
async function actions(s:Session):Promise<string[][]>{return (await s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state.actions)).map(x=>JSON.parse(x) as string[]);}
async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/simple-chat-panels-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('SC_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}
async function openEntry(s:Session,name:string):Promise<void>{const settings=s.page.getByRole('button',{name:'更多设置',exact:true});if(await settings.count()&&await settings.getAttribute('aria-expanded')==='false'){await settings.click();await settle(s.page);}await click(s,s.page.getByTitle(name,{exact:true}));}
async function openPanel(s:Session,name:'用户记忆'|'项目指令'):Promise<Locator>{await openEntry(s,name);return name==='用户记忆'?s.page.getByText('AI 记忆',{exact:true}).locator('../../..'):s.page.getByRole('heading',{name:'项目指令',exact:true}).locator('../..');}
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
async function click(s:Session,control:Locator):Promise<void>{await reveal(s,control);await control.click();await settle(s.page);}
const memoryInput=(p:Locator):Locator=>p.getByPlaceholder('例如：我偏好简洁有力的短句风格...',{exact:true});
const memoryAdd=(p:Locator):Locator=>p.getByRole('button',{name:'添加',exact:true});
const seedRow=(p:Locator):Locator=>p.locator('p').filter({hasText:'原有记忆 0 '}).locator('..');
async function fillMemory(s:Session,p:Locator):Promise<void>{await click(s,p.getByRole('button',{name:'偏好设置',exact:true}));await reveal(s,memoryInput(p));await memoryInput(p).fill(MEMORY_TEXT);}
async function submitMemory(s:Session,p:Locator):Promise<void>{await click(s,memoryAdd(p));}
async function waitHeld(s:Session):Promise<void>{await expect.poll(()=>s.gates.length,{timeout:1500}).toBe(1);}

describe('simple panels sidebar names',()=>{
  it.each(THEMES)('%s names each navigation and row action without relying on an icon',async theme=>{await withSession(theme,390,844,{surface:'sidebar'},async s=>{
    const empty=await s.page.locator('aside button,aside input').evaluateAll(es=>es.filter(e=>!(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent||'').trim()).length);
    expect(empty,'sidebar unnamed controls').toBe(0);
  });},25000);
});
describe('simple panels sidebar layout',()=>{
  it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height reaches every visible action without horizontal overflow',async({theme,width,height})=>{await withSession(theme,width,height,{surface:'sidebar'},async s=>{
    const aside=s.page.locator('aside');await panelBounds(aside);const all=aside.getByRole('button');
    for(const control of await all.all()){await reveal(s,control);await target(control);expect(await control.evaluate(e=>{let alpha=1;for(let p:Element|null=e;p;p=p.parentElement)alpha*=Number(getComputedStyle(p).opacity);return alpha;}),'sidebar action is visible without hover').toBe(1);}
    expect(await aside.evaluate(e=>[...e.querySelectorAll('*')].every(n=>n.scrollWidth<=n.clientWidth+1||getComputedStyle(n).overflowX==='hidden')),'sidebar descendants do not overflow horizontally').toBe(true);
    await capture(s,theme+'-sidebar-'+width+'x'+height);
  });},25000);
});
describe('simple panels sidebar operations',()=>{
  it.each(THEMES)('%s selects and renames the intended item while row actions do not select another task',async theme=>{await withSession(theme,390,844,{surface:'sidebar'},async s=>{
    const name='手机项目一很长的项目名称用于检查边界';
    await click(s,s.page.getByRole('button',{name:'收起项目 '+name,exact:true}));expect(await s.page.getByText('对话0很长的名称检查按钮是否可见',{exact:true}).count()).toBe(0);
    await click(s,s.page.getByRole('button',{name:'展开项目 '+name,exact:true}));await click(s,s.page.getByText('对话2很长的名称检查按钮是否可见',{exact:true}));
    expect(await actions(s)).toEqual([['project','project-one'],['task','task-2']]);
    await click(s,s.page.getByRole('button',{name:'重命名对话 对话2很长的名称检查按钮是否可见',exact:true}));
    const input=s.page.getByRole('textbox',{name:'对话名称',exact:true});await input.fill('重命名后的对话');await input.press('Enter');await settle(s.page);
    expect(await s.page.getByText('重命名后的对话',{exact:true}).count()).toBe(1);expect((await actions(s)).at(-1)).toEqual(['rename-task','project-one','task-2','重命名后的对话']);
    const before=(await actions(s)).length;await click(s,s.page.getByRole('button',{name:'删除对话 重命名后的对话',exact:true}));expect((await actions(s)).slice(before)).toEqual([['delete-task','project-one','task-2']]);
    const renameBefore=(await actions(s)).length;await click(s,s.page.getByRole('button',{name:'重命名项目 '+name,exact:true}));const projectInput=s.page.getByRole('textbox',{name:'项目名称',exact:true});await projectInput.click();await projectInput.fill('重命名后的项目');await projectInput.press('Enter');await settle(s.page);
    expect(await s.page.getByRole('button',{name:'选择项目 重命名后的项目',exact:true}).count()).toBe(1);expect((await actions(s)).slice(renameBefore),'renaming project does not select it').toEqual([['rename-project','project-one','重命名后的项目']]);
    const extraBefore=(await actions(s)).length;await click(s,s.page.getByRole('button',{name:'新建对话 重命名后的项目',exact:true}));await click(s,s.page.getByRole('button',{name:'在项目 重命名后的项目 新建对话',exact:true}));await click(s,s.page.getByRole('button',{name:'删除项目 手机项目二',exact:true}));await click(s,s.page.getByRole('button',{name:'新建项目',exact:true}));await click(s,s.page.getByRole('button',{name:'退出登录',exact:true}));
    expect((await actions(s)).slice(extraBefore)).toEqual([['create-task','project-one'],['create-task','project-one'],['delete-project','project-two'],['create-project'],['logout']]);
    await click(s,s.page.getByRole('button',{name:'关闭对话侧栏',exact:true}));expect(await s.page.locator('aside').count()).toBe(0);
  });},25000);
});
describe('simple panels instructions labels',()=>{
  it.each(THEMES)('%s focuses all five labels and saves only the intended project instructions',async theme=>{await withSession(theme,390,844,{},async s=>{
    const initialWrites=await s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state.projectWrites.length);
    const p=await openPanel(s,'项目指令');
    const fields=[['项目背景','新背景'],['用户偏好','新偏好'],['输出格式','新格式'],['风格规则','新风格'],['禁止规则','新约束']];
    for(const [label,value]of fields){const el=p.getByLabel(label,{exact:true});expect(await el.count(),'instructions associated label exists').toBe(1);await click(s,p.locator('label').filter({hasText:label}));expect(await el.evaluate(e=>e===document.activeElement),'instructions label focuses field').toBe(true);await el.fill(value);expect(await el.evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'instruction input font').toBeGreaterThanOrEqual(16);}
    await click(s,p.getByRole('button',{name:'保存指令',exact:true}));expect(await s.page.getByRole('heading',{name:'项目指令',exact:true}).count()).toBe(0);
    const writes=(await s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state.projectWrites)).slice(initialWrites);expect(writes.length,'one explicit instructions save').toBe(1);
    expect(writes[0]).toMatchObject({id:'project-one',instructions:{projectBackground:'新背景',userPreference:'新偏好',outputFormat:'新格式',styleRules:'新风格',forbiddenRules:'新约束',language:'zh-CN'}});
    const reopened=await openPanel(s,'项目指令');for(const [label,value]of fields)expect(await reopened.getByLabel(label,{exact:true}).inputValue()).toBe(value);
  });},25000);
});
describe('simple panels instructions layout',()=>{
  it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height scrolls the form and keeps a touch-sized close reachable',async({theme,width,height})=>{await withSession(theme,width,height,{},async s=>{
    const p=await openPanel(s,'项目指令');await panelBounds(p);const close=p.locator(':scope > div').first().getByRole('button');await target(close);
    const save=p.getByRole('button',{name:'保存指令',exact:true});await reveal(s,save);await target(save);await reveal(s,close);await target(close);await capture(s,theme+'-instructions-'+width+'x'+height);await close.click();await settle(s.page);expect(await s.page.getByRole('heading',{name:'项目指令',exact:true}).count()).toBe(0);
  });},25000);
});
describe('simple panels shared header',()=>{
  it.each(['Agent 模式','知识库','项目内搜索'])('%s exposes its unchanged shared close action with an accessible name',async entry=>{await withSession('gold',390,844,{},async s=>{
    await openEntry(s,entry);const title=entry==='Agent 模式'?'Agent 管理':entry;const close=s.page.getByRole('button',{name:'关闭'+title,exact:true});expect(await close.count(),'shared header named close').toBe(1);await target(close);await close.click();await settle(s.page);expect(await s.page.getByRole('heading',{name:title,exact:true}).count()).toBe(0);
  });},25000);
});
describe('simple panels memory semantics',()=>{
  it.each(THEMES)('%s labels the input and exposes the chosen category independently of color',async theme=>{await withSession(theme,390,844,{},async s=>{
    const p=await openPanel(s,'用户记忆');const input=p.getByRole('textbox',{name:'记忆内容',exact:true});expect(await input.count(),'memory input accessible name').toBe(1);
    for(const name of ['写作风格','偏好设置','背景信息','其他']){await click(s,p.getByRole('button',{name,exact:true}));expect(await p.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'memory category pressed state').toBe('true');expect(await p.locator('button[aria-pressed="true"]').count()).toBe(1);}
  });},25000);
});
describe('simple panels memory layout',()=>{
  it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps long memories and all controls inside the panel',async({theme,width,height})=>{await withSession(theme,width,height,{populated:true},async s=>{
    const p=await openPanel(s,'用户记忆');await panelBounds(p);const close=p.locator(':scope > div').first().getByRole('button');await target(close);
    for(const control of [...await p.getByRole('button',{name:/^(写作风格|偏好设置|背景信息|其他|添加)$/}).all(),memoryInput(p)]){await reveal(s,control);await target(control);}
    expect(await memoryInput(p).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'memory input font').toBeGreaterThanOrEqual(16);
    const last=p.locator('p').filter({hasText:'原有记忆 19 '}).locator('..').getByRole('button');await reveal(s,last);await target(last);await reveal(s,close);await capture(s,theme+'-memory-'+width+'x'+height);await close.click();await settle(s.page);expect(await s.page.getByText('AI 记忆',{exact:true}).count()).toBe(0);
  });},25000);
});
describe('simple panels memory pending',()=>{
  it.each(THEMES)('%s keeps the draft and disables duplicate submission until the add actually succeeds',async theme=>{await withSession(theme,390,844,{ops:[{method:'POST',hold:true}]},async s=>{
    const p=await openPanel(s,'用户记忆');await fillMemory(s,p);await submitMemory(s,p);await waitHeld(s);
    expect(await memoryInput(p).inputValue(),'pending memory draft remains').toBe(MEMORY_TEXT);expect(await memoryAdd(p).isDisabled(),'pending memory submission disabled').toBe(true);expect(await s.page.getByText('已添加到记忆',{exact:true}).count(),'no premature memory success').toBe(0);
    s.gates[0].release();await nativeRequestsFinished(s);await settle(s.page);expect(await p.getByText(MEMORY_TEXT,{exact:true}).count()).toBe(1);expect(await memoryInput(p).inputValue()).toBe('');
  });},25000);
});
describe('simple panels memory rejection',()=>{
  it.each(THEMES)('%s preserves an add draft and shows an error when the real parent receives HTTP 403',async theme=>{await withSession(theme,390,844,{ops:[{method:'POST',status:403}]},async s=>{
    const p=await openPanel(s,'用户记忆');await fillMemory(s,p);await submitMemory(s,p);await nativeRequestsFinished(s);await settle(s.page);
    expect(await memoryInput(p).inputValue(),'rejected memory draft remains').toBe(MEMORY_TEXT);expect(await p.getByRole('alert').count(),'memory rejection is visible').toBe(1);expect(await s.page.getByText('已添加到记忆',{exact:true}).count(),'rejected add is not success').toBe(0);expect(await memoryAdd(p).isEnabled()).toBe(true);
    const ratio=await textContrast(p.getByRole('alert'));console.log('SC_UI_ERROR_CONTRAST',JSON.stringify({theme,method:'POST',ratio}));expect(ratio,'memory error text contrast').toBeGreaterThanOrEqual(4.5);
  });},25000);
  it.each(THEMES)('%s keeps a memory when the real parent receives a rejected DELETE',async theme=>{await withSession(theme,390,844,{ops:[{method:'DELETE',status:403}]},async s=>{
    const p=await openPanel(s,'用户记忆');await click(s,seedRow(p).getByRole('button'));await nativeRequestsFinished(s);await settle(s.page);
    expect(await seedRow(p).count(),'rejected deletion keeps memory row').toBe(1);expect(await p.getByRole('alert').count(),'memory delete rejection is visible').toBe(1);expect(await s.page.getByText('已删除',{exact:true}).count(),'rejected delete is not success').toBe(0);
    const ratio=await textContrast(p.getByRole('alert'));console.log('SC_UI_ERROR_CONTRAST',JSON.stringify({theme,method:'DELETE',ratio}));expect(ratio,'memory error text contrast').toBeGreaterThanOrEqual(4.5);
  });},25000);
});
describe('simple panels memory recovery',()=>{
  it.each(THEMES)('%s retries a refused add only on a new explicit user action',async theme=>{await withSession(theme,390,844,{ops:[{method:'POST',status:403},{method:'POST'}]},async s=>{
    const p=await openPanel(s,'用户记忆');await fillMemory(s,p);await submitMemory(s,p);await nativeRequestsFinished(s);await settle(s.page);expect(await memoryInput(p).inputValue()).toBe(MEMORY_TEXT);
    expect(s.consumed,'no automatic memory retry').toBe(1);await submitMemory(s,p);await nativeRequestsFinished(s);await settle(s.page);expect(await p.getByText(MEMORY_TEXT,{exact:true}).count()).toBe(1);expect(await p.getByRole('alert').count()).toBe(0);expect(await memoryInput(p).inputValue()).toBe('');
  });},25000);
  it.each(THEMES)('%s does not erase a reopened-panel draft when an earlier add finishes late',async theme=>{await withSession(theme,390,844,{ops:[{method:'POST',hold:true}]},async s=>{
    let p=await openPanel(s,'用户记忆');await fillMemory(s,p);await submitMemory(s,p);await waitHeld(s);await p.locator(':scope > div').first().getByRole('button').click();p=await openPanel(s,'用户记忆');await memoryInput(p).fill('新面板草稿');s.gates[0].release();await nativeRequestsFinished(s);await settle(s.page);expect(await memoryInput(p).inputValue()).toBe('新面板草稿');expect(await p.getByText(MEMORY_TEXT,{exact:true}).count()).toBe(1);
  });},25000);
  it.each(['POST','DELETE'] as const)('%s network failure stays handled and does not masquerade as a successful operation',async method=>{await withSession('mono',390,844,{ops:[{method,network:true}]},async s=>{
    const p=await openPanel(s,'用户记忆');if(method==='POST'){await fillMemory(s,p);await submitMemory(s,p);}else await click(s,seedRow(p).getByRole('button'));await nativeRequestsFinished(s);await settle(s.page);expect(await p.getByRole('alert').count()).toBe(1);if(method==='POST')expect(await memoryInput(p).inputValue()).toBe(MEMORY_TEXT);else expect(await seedRow(p).count()).toBe(1);
  });},25000);
});
describe('simple panels memory enter',()=>{
  it.each(THEMES)('%s keeps Enter submissions pending and rejects a second Enter before settlement',async theme=>{await withSession(theme,390,844,{ops:[{method:'POST',hold:true}]},async s=>{
    const p=await openPanel(s,'用户记忆');await fillMemory(s,p);await memoryInput(p).press('Enter');await waitHeld(s);
    expect(await memoryInput(p).inputValue(),'pending Enter draft remains').toBe(MEMORY_TEXT);expect(await memoryAdd(p).isDisabled(),'pending Enter add disabled').toBe(true);
    await memoryInput(p).press('Enter');await settle(s.page);expect(s.consumed,'only one Enter request').toBe(1);s.gates[0].release();await nativeRequestsFinished(s);await settle(s.page);expect(await p.getByText(MEMORY_TEXT,{exact:true}).count()).toBe(1);
  });},25000);
});
describe('simple panels memory repeated delete',()=>{
  it.each(THEMES)('%s disables the same deletion while its acknowledgement is pending',async theme=>{await withSession(theme,390,844,{ops:[{method:'DELETE',hold:true}]},async s=>{
    const p=await openPanel(s,'用户记忆'),control=seedRow(p).getByRole('button');await click(s,control);await waitHeld(s);
    expect(await control.isDisabled(),'pending deletion disabled').toBe(true);expect(await seedRow(p).count()).toBe(1);await s.page.keyboard.press('Enter');await settle(s.page);expect(s.consumed).toBe(1);s.gates[0].release();await nativeRequestsFinished(s);await settle(s.page);expect(await seedRow(p).count()).toBe(0);
  });},25000);
});
describe('simple panels memory shared pending',()=>{
  it.each(['POST','DELETE'] as const)('%s remains owned by the real parent after the panel closes and reopens, including late failure',async method=>{await withSession('gold',390,844,{ops:[{method,hold:true,status:403}]},async s=>{
    let p=await openPanel(s,'用户记忆');if(method==='POST'){await fillMemory(s,p);await submitMemory(s,p);}else await click(s,seedRow(p).getByRole('button'));await waitHeld(s);
    await p.locator(':scope > div').first().getByRole('button').click();p=await openPanel(s,'用户记忆');await memoryInput(p).fill('新面板草稿');
    expect(await memoryAdd(p).isDisabled(),'reopened pending add disabled').toBe(true);expect(await seedRow(p).getByRole('button').isDisabled(),'reopened pending delete disabled').toBe(true);
    await memoryInput(p).press('Enter');await settle(s.page);expect(s.consumed).toBe(1);s.gates[0].release();await nativeRequestsFinished(s);await settle(s.page);
    expect(await memoryInput(p).inputValue()).toBe('新面板草稿');expect(await seedRow(p).count()).toBe(1);expect(await memoryAdd(p).isEnabled()).toBe(true);expect(await p.getByRole('alert').count(),'old failure does not become a new-panel error').toBe(0);expect(await s.page.locator('[data-sonner-toast]').count(),'closed-panel failure has no late toast').toBe(0);
  });},25000);
});
describe('simple panels memory response',()=>{
  it.each((['POST','DELETE'] as const).flatMap(method=>(['invalid-json','invalid-object'] as const).map(reply=>({method,reply}))))('$method $reply is an error rather than a successful edit of the visible memories',async({method,reply})=>{await withSession('mono',390,844,{ops:[{method,reply}]},async s=>{
    const p=await openPanel(s,'用户记忆');if(method==='POST'){await fillMemory(s,p);await submitMemory(s,p);}else await click(s,seedRow(p).getByRole('button'));await nativeRequestsFinished(s);await settle(s.page);
    if(method==='POST')expect(await memoryInput(p).inputValue(),'invalid response keeps add draft').toBe(MEMORY_TEXT);else expect(await seedRow(p).count(),'invalid response keeps memory row').toBe(1);expect(await p.getByRole('alert').count()).toBe(1);expect(await s.page.locator('[data-sonner-toast][data-type="success"]').count()).toBe(0);
  });},25000);
});
describe('simple panels rotation',()=>{
  it.each(THEMES)('%s preserves the instruction draft across mobile landscape and desktop without remount',async theme=>{await withSession(theme,390,844,{},async s=>{
    const initialWrites=await s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state.projectWrites.length);
    const p=await openPanel(s,'项目指令'),field=p.getByPlaceholder('例如：这是一个电商客服系统...',{exact:true});await field.fill('旋转后的草稿保留');
    for(const [width,height]of [[640,320],[1440,900],[320,640]]){await s.page.setViewportSize({width,height});await settle(s.page);await panelBounds(p);expect(await field.inputValue()).toBe('旋转后的草稿保留');if(width===1440)await capture(s,theme+'-instructions-desktop');}
    expect((await s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state.projectWrites.length))-initialWrites,'rotation does not save instructions').toBe(0);
  });},25000);
});
describe('simple panels contrast',()=>{
  it.each(THEMES)('%s keeps instruction text, placeholders and selected memory categories readable',async theme=>{await withSession(theme,390,844,{},async s=>{
    let p=await openPanel(s,'项目指令');const samples:Array<{label:string;ratio:number}>=[];
    for(const control of [...await p.locator('label,textarea').all(),p.getByRole('button',{name:'保存指令',exact:true})]){await reveal(s,control);const placeholder=await control.evaluate(e=>e instanceof HTMLTextAreaElement);const ratio=await textContrast(control,placeholder);samples.push({label:await control.evaluate(e=>e instanceof HTMLTextAreaElement?e.placeholder:e.textContent??''),ratio});}
    await click(s,p.locator(':scope > div').first().getByRole('button'));p=await openPanel(s,'用户记忆');
    for(const name of ['写作风格','偏好设置','背景信息','其他']){const control=p.getByRole('button',{name,exact:true});await click(s,control);samples.push({label:name,ratio:await textContrast(control)});}
    await reveal(s,memoryInput(p));samples.push({label:'memory placeholder',ratio:await textContrast(memoryInput(p),true)});await memoryInput(p).fill(MEMORY_TEXT);
    const paint=():Promise<{disabled:boolean;opacity:string;background:string;color:string}>=>memoryAdd(p).evaluate(e=>({disabled:(e as HTMLButtonElement).disabled,opacity:getComputedStyle(e).opacity,background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));const initialPaint=await paint();
    await expect.poll(async()=>{const value=await paint();return !value.disabled&&Number(value.opacity)===1;},{timeout:1500}).toBe(true);
    samples.push({label:'memory enabled add',ratio:await textContrast(memoryAdd(p))});console.log('SC_UI_ADD_PAINT',JSON.stringify({theme,initial:initialPaint,final:await paint()}));console.log('SC_UI_TEXT_CONTRAST',JSON.stringify({theme,samples}));expect(Math.min(...samples.map(x=>x.ratio)),'simple panels text contrast').toBeGreaterThanOrEqual(4.5);
  });},25000);
});
describe('simple panels sidebar contrast',()=>{
  it.each(THEMES)('%s keeps secondary navigation text legible in the actual sidebar palette',async theme=>{await withSession(theme,390,844,{surface:'sidebar'},async s=>{
    const aside=s.page.locator('aside');const samples:Array<{label:string;ratio:number}>=[];
    for(const control of [aside.getByText('无界AI',{exact:true}),aside.getByText('用户',{exact:true}),aside.getByRole('button',{name:'新建项目',exact:true}),aside.getByRole('button',{name:'新建对话 手机项目二',exact:true})]){await reveal(s,control);samples.push({label:await control.innerText(),ratio:await textContrast(control)});}
    console.log('SC_UI_SIDEBAR_CONTRAST',JSON.stringify({theme,samples}));expect(Math.min(...samples.map(x=>x.ratio)),'sidebar secondary text contrast').toBeGreaterThanOrEqual(4.5);
  });},25000);
});
describe('simple panels fixture boundary',()=>{
  it('rejects a missing promised POST instead of passing an unsubmitted operation',async()=>{const s=await session('gold',390,844,{ops:[{method:'POST'}]});await expect(dispose(s)).rejects.toThrow('SC_UI_FIXTURE_REQUEST_VALIDATION');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{const s=await session('gold',390,844,{surface:'sidebar'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}},25000);
  it.each(['http','websocket'] as const)('preserves a cleanup failure alongside expected %s refusal',async transport=>{const s=await session('gold',390,844,{surface:'sidebar'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});
