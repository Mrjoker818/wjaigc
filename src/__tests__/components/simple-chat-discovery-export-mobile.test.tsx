// @vitest-environment node
// Production search/export/share and real ChatArea/Providers/CSS; only synthetic .invalid I/O.
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type Request} from '@playwright/test';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
type Theme='gold'|'mono';
type Surface='search'|'report'|'share'|'chat';
type Reply='ok'|'http'|'network'|'invalid-json'|'invalid-object'|'external'|'mismatched';
interface Operation{reply?:Reply;hold?:boolean}
interface Options{surface?:Surface;empty?:boolean;ops?:Operation[];clipboardDenied?:boolean;clipboardHold?:boolean}
interface Gate{wait:Promise<void>;release():void}
interface FixtureWindow extends Window{scUi:{mount(theme:Theme,options:Options):void;unmount():void;state:{disposed:boolean;closed:number;navigated:Array<{conversationId:string;messageId?:string}>;selectedTasks:string[]}};clipboardFixture:{release():void;pending:number}}
interface Session{context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;plannedFailed:Set<Request>;nativeWaiters:Set<()=>void>;gates:Gate[];mounted:boolean;consumed:Set<number>;bodies:Array<{path:string;body:Record<string,unknown>;operation:string}>}
const ORIGIN='https://simple-chat-discovery-export-mobile.invalid';
const THEMES:Theme[]=['gold','mono'];
const TITLE="合成:移动/报告?很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题",CONTENT="合成完整报告\n\n中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 \nhttps://result.invalid/long-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segment\n末行 END";
const SHARE_ID='0123456789abcdef';
const MODEL_FIXTURE=[{id:'synthetic-model',providerId:'synthetic-provider',displayName:'合成模型',providerName:'合成供应商'}];
const ENTRY="\nimport React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport ChatArea from '@/components/simple-chat/chat-area';\nimport {GlobalSearch} from '@/components/simple-chat/global-search';\nimport {ReportExport} from '@/components/simple-chat/report-export';\nimport {ShareDialog} from '@/components/simple-chat/share-dialog';\nimport {Providers,useTheme} from '@/app/simple-chat/providers';\nimport {Toaster} from 'sonner';\nimport type {SimpleChatProject,SimpleChatTask} from '@/components/simple-chat/simple-chat-types';\nconst TITLE=\"合成:移动/报告?很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题很长的任务标题\",CONTENT=\"合成完整报告\\n\\n中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 中文长段落 \\nhttps://result.invalid/long-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segmentlong-segment\\n末行 END\";\nconst messages=[{id:'user-one',role:'user',content:'合成关键词 user',timestamp:1},{id:'answer-one',role:'assistant',content:CONTENT,timestamp:2}];\nconst conversations=[{id:'conv-one',title:'第一合成会话',messages:[{id:'first-message',role:'user',content:'关键词 第一段'}]},{id:'conv-two',title:'第二合成会话',messages:Array.from({length:37},(_,i)=>({id:'result-'+i,role:i%2?'user':'assistant',content:'关键词 '+i+' '+('中文长内容'.repeat(20))+' https://result.invalid/'+('long-url'.repeat(20))}))}];\nconst seed:SimpleChatProject={id:'project-one',name:'合成项目',createdAt:1,updatedAt:1,agents:[],knowledgeItems:[],tasks:[{id:'task-one',projectId:'project-one',name:TITLE,messages:messages.map(m=>({id:m.id,role:m.role as 'user'|'assistant',content:m.content,createdAt:m.timestamp})),model:'',providerId:'',createdAt:1,updatedAt:1},{id:'task-two',projectId:'project-one',name:'第二合成对话',messages:[{id:'other-message',role:'user',content:'第二个目标关键词',createdAt:3}],model:'',providerId:'',createdAt:1,updatedAt:1}]};\nconst user={id:'synthetic-mobile-user',name:'仅本地界面合成用户',role:'user' as const,status:'active' as const,productType:'chat' as const,createdAt:1,updatedAt:1};\nconst root=createRoot(document.getElementById('fixture-root')!);let mounted=false;\nconst state={disposed:false,closed:0,navigated:[] as Array<{conversationId:string;messageId?:string}>,selectedTasks:[] as string[]};\nfunction Entry({options}:{options:{surface?:'search'|'report'|'share'|'chat';empty?:boolean}}){\n const [project,setProject]=useState(seed),[active,setActive]=useState('task-one'),[open,setOpen]=useState(true);const {theme}=useTheme();\n const close=()=>{state.closed++;setOpen(false);};const unavailable=()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_WRITE');};\n return <div className=\"h-full w-full min-w-0 overflow-hidden\">{options.surface==='chat'?<ChatArea user={user} project={project} task={project.tasks.find(t=>t.id===active)!} onUpdateTask={(task:SimpleChatTask)=>setProject(p=>({...p,tasks:p.tasks.map(t=>t.id===task.id?task:t)}))} onPersistTask={async()=>{unavailable();}} onUpdateProject={setProject} onCreateTask={unavailable} onSelectTask={(task)=>{state.selectedTasks.push(task.id);setActive(task.id);}} onUpdateAgent={unavailable} onDeleteAgent={unavailable} onSkillToAgent={unavailable} onLogout={unavailable} onBackToWorkspace={unavailable} sidebarOpen={false} onToggleSidebar={unavailable}/>:open?(options.surface==='report'?<ReportExport isMonochrome={theme!=='dark'} title={TITLE} content={options.empty?'':CONTENT} onClose={close}/>:options.surface==='share'?<ShareDialog userId={user.id} conversationId=\"task-one\" conversationTitle={TITLE} messages={[{id:'system-one',role:'system',content:'合成内部消息'},...messages]} onClose={close}/>:<GlobalSearch conversations={options.empty?[]:conversations} onClose={close} onNavigate={(conversationId,messageId)=>state.navigated.push({conversationId,messageId})}/>):<button className=\"min-h-11 min-w-11\" onClick={()=>setOpen(true)}>重新打开</button>}<Toaster/></div>;\n}\nObject.assign(window,{scUi:{state,mount(theme:'gold'|'mono',options:{surface?:'search'|'report'|'share'|'chat';empty?:boolean}){if(mounted||state.disposed)throw Error('SC_UI_FIXTURE_REMOUNT');mounted=true;localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');root.render(<Providers><Entry options={options}/></Providers>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});\n";
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-chat-discovery-export-mobile-entry.tsx' },
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
function replyBody(op:Operation):{status:number;contentType:string;body:string}{
 if(op.reply==='http')return{status:403,contentType:'application/json',body:JSON.stringify({error:'合成分享服务拒绝'})};
 if(op.reply==='invalid-json')return{status:200,contentType:'application/json',body:'{invalid'};
 if(op.reply==='invalid-object')return{status:200,contentType:'application/json',body:JSON.stringify({shareId:SHARE_ID,shareUrl:{path:'/shared/'+SHARE_ID}})};
 if(op.reply==='external')return{status:200,contentType:'application/json',body:JSON.stringify({shareId:SHARE_ID,shareUrl:'https://other.invalid/shared/'+SHARE_ID})};
 if(op.reply==='mismatched')return{status:200,contentType:'application/json',body:JSON.stringify({shareId:SHARE_ID,shareUrl:'/shared/ffffffffffffffff'})};
 return{status:200,contentType:'application/json',body:JSON.stringify({shareId:SHARE_ID,shareUrl:'/shared/'+SHARE_ID})};
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
   const r=route.request(),u=new URL(r.url()),h=r.headers(),key=keyOf(r);
   const sharePost=r.method()==='POST'&&u.pathname==='/api/simple-chat/share'&&!u.search;
   if(u.origin!==ORIGIN||u.username||u.password||h.authorization||h.cookie||h['x-api-key']||h['api-key']||(!sharePost&&(h['idempotency-key']||h['x-wujie-expected-actor-id'])))throw Error('SC_UI_FIXTURE_HTTP_BOUNDARY');
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
   if(sharePost&&/^application\/json(?:;|$)/.test(h['content-type']??'')){
    const body:unknown=JSON.parse(r.postData()??'null');if(!body||typeof body!=='object'||Array.isArray(body))throw Error('SC_UI_FIXTURE_BODY');const b=body as Record<string,unknown>;
    const expectedBody={conversationId:'task-one',title:TITLE,messages:[{id:'user-one',role:'user',content:'合成关键词 user',timestamp:1},{id:'answer-one',role:'assistant',content:CONTENT,timestamp:2}]};
    if(JSON.stringify(b)!==JSON.stringify(expectedBody))throw Error('SC_UI_FIXTURE_SHARE_BODY');
    const operation=h['idempotency-key'];
    if(!operation||!/^[0-9a-f-]{36}$/.test(operation)||h['x-wujie-expected-actor-id']!=='synthetic-mobile-user')throw Error('SC_UI_FIXTURE_SHARE_SCOPE');
    const expected=(options.ops??[]).findIndex((_,i)=>!s.consumed.has(i));if(expected<0)throw Error('SC_UI_FIXTURE_UNPROMISED_POST');const op=options.ops![expected];s.consumed.add(expected);s.bodies.push({path:u.pathname,body:b,operation});
    if(op.hold){const g=gate();s.gates.push(g);await g.wait;}
    if(op.reply==='network'){s.plannedFailed.add(r);await route.abort('failed');return;}
    await route.fulfill(replyBody(op));return;
   }
   throw Error('SC_UI_FIXTURE_UNKNOWN_HTTP '+key);
  })().catch(async e=>{s.errors.push(String(e));s.refused.add(route.request());await route.abort('blockedbyclient');});s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);}});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});
  await page.addInitScript(({deny,hold})=>{let release=():void=>{};const wait=new Promise<void>(r=>{release=r;});const fixture={release,pending:0};Object.assign(window,{clipboardFixture:fixture});if(deny||hold){const original=navigator.clipboard.writeText.bind(navigator.clipboard);Object.defineProperty(navigator.clipboard,'writeText',{value:async(text:string)=>{fixture.pending++;try{if(hold)await wait;if(deny)throw new DOMException('合成剪贴板拒绝','NotAllowedError');await original(text);}finally{fixture.pending--;}}});}},{deny:!!options.clipboardDenied,hold:!!options.clipboardHold});
  await page.goto(ORIGIN);await page.addScriptTag({content:bundle});await page.evaluate(({theme,options})=>(window as unknown as FixtureWindow).scUi.mount(theme,options),{theme,options});s.mounted=true;
  await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===(t==='mono'?'light':'dark'),theme,{timeout:1500});
  if(options.surface==='chat'){await page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true}).waitFor();await nativeRequestsFinished(s);}
  else if(options.surface==='report')await page.getByText('导出报告',{exact:true}).waitFor();else if(options.surface==='share')await page.getByText('分享对话',{exact:true}).waitFor();else await page.getByPlaceholder('搜索所有对话内容...',{exact:true}).waitFor();await settle(page);return s;
 }catch(e){try{if(value)await dispose(value);else{await context.close();contexts.delete(context);}}catch(cleanup){throw new AggregateError([e,cleanup],'SC_UI_FIXTURE_BOOTSTRAP');}throw e;}
}
async function nativeRequestsFinished(s:Session):Promise<void>{let notify:(()=>void)|undefined;try{await bounded('native requests',()=>new Promise<void>(resolve=>{notify=()=>{if(!s.pending.size)resolve();};s.nativeWaiters.add(notify);notify();}));}finally{if(notify)s.nativeWaiters.delete(notify);}}
async function dispose(s:Session,refusal?:'http'|'websocket',cleanupProbe?:()=>void):Promise<void>{
 const failures:string[]=[];try{if(s.mounted)await bounded('unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.unmount()));cleanupProbe?.();}catch(e){failures.push(String(e));}for(const g of s.gates)g.release();try{await bounded('clipboard drain',async()=>{await s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.release());await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).clipboardFixture.pending===0,undefined,{timeout:1500});});}catch(e){failures.push(String(e));}
 try{await bounded('routes',()=>Promise.all([...s.handlers]));await nativeRequestsFinished(s);await bounded('final routes',()=>Promise.all([...s.handlers]));}catch(e){failures.push(String(e));}const unresolved=s.pending.size!==0||s.handlers.size!==0;
 try{await s.context.close();contexts.delete(s.context);live.delete(s);}catch(e){failures.push(String(e));}
 const startup=['GET /'];if(s.options.surface==='chat')startup.push('GET /api/models?type=chat','GET /api/models?type=image','GET /api/user-data/sync?key=projects','GET /api/simple-chat/memory');
 const posts=(s.options.ops??[]).map(()=>'POST /api/simple-chat/share');const required=[...new Set([...startup,...posts,...(refusal==='http'?['GET /unexpected']:[])])];
 if(s.consumed.size!==(s.options.ops?.length??0)||JSON.stringify([...s.counts.keys()].sort())!==JSON.stringify(required.sort())||startup.some(k=>(s.counts.get(k)??0)<1||(s.counts.get(k)??0)>(k==='GET /'?1:2))||posts.some(k=>s.counts.get(k)!==posts.filter(x=>x===k).length))throw Error('SC_UI_FIXTURE_REQUEST_VALIDATION');
 const expectedNetwork=(s.options.ops??[]).filter(o=>o.reply==='network').map(()=>'POST /api/simple-chat/share');
 if(JSON.stringify([...s.plannedFailed].map(keyOf).sort())!==JSON.stringify(expectedNetwork.sort()))throw Error('SC_UI_FIXTURE_NATIVE_ABORT_CONTRACT');
 const expectedFailed=new Set(s.plannedFailed);if(refusal==='http'){if(s.refused.size!==1||keyOf([...s.refused][0])!=='GET /unexpected')throw Error('SC_UI_FIXTURE_REFUSAL_CONTRACT');expectedFailed.add([...s.refused][0]);}else if(s.refused.size)throw Error('SC_UI_FIXTURE_UNEXPECTED_REFUSAL');
 const completedByKey=new Map<string,number>();for(const r of s.completed)completedByKey.set(keyOf(r),(completedByKey.get(keyOf(r))??0)+1);const failedByKey=new Map<string,number>();for(const r of expectedFailed)failedByKey.set(keyOf(r),(failedByKey.get(keyOf(r))??0)+1);
 if(unresolved||s.failed.size!==expectedFailed.size||[...s.failed].some(r=>!expectedFailed.has(r))||[...s.counts].some(([k,n])=>(completedByKey.get(k)??0)+(failedByKey.get(k)??0)!==n))throw Error('SC_UI_FIXTURE_NATIVE_REQUEST_FAILURE');
 if(failures.length)throw Error('SC_UI_FIXTURE_CLEANUP_FAILURE: '+failures.join('; '));if(refusal){const expected=refusal==='http'?'Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_UNKNOWN_WS';if(s.errors.length!==1||s.errors[0]!==expected)throw Error('SC_UI_FIXTURE_UNEXPECTED_FAILURES: '+s.errors.join('; '));}if(s.errors.length)throw Error('SC_UI_FIXTURE_INFRASTRUCTURE: '+s.errors.join('; '));
}
async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'SC_UI_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;}
async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/simple-chat-discovery-export-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('SC_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}
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



const panel=(s:Session,surface:'search'|'report'|'share'):Locator=>surface==='search'?s.page.getByPlaceholder('搜索所有对话内容...',{exact:true}).locator('../..'):s.page.getByText(surface==='report'?'导出报告':'分享对话',{exact:true}).locator('../../..');
const closeControl=(p:Locator):Locator=>p.locator(':scope > div').first().getByRole('button').last();
const field=(p:Locator,surface:'search'|'report'|'share'):Locator=>surface==='search'?p.getByPlaceholder('搜索所有对话内容...',{exact:true}):surface==='report'?p.getByPlaceholder('输入报告标题…',{exact:true}):p.locator('input');
async function awaitUi(s:Session):Promise<void>{await nativeRequestsFinished(s);await settle(s.page);}
const state=(s:Session)=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state);
async function createShare(s:Session):Promise<Locator>{const p=panel(s,'share');await click(s,p.getByRole('button',{name:'创建分享链接',exact:true}));return p;}
async function moreEntry(s:Session,label:string):Promise<void>{const settings=s.page.getByRole('button',{name:'更多设置',exact:true});if(await settings.count()&&await settings.getAttribute('aria-expanded')==='false')await click(s,settings);await click(s,s.page.getByTitle(label,{exact:true}));}

it('scrolls the real mobile chat to a matched message before and after switching conversations', async () => {
  await withSession('gold', 390, 844, { surface: 'chat' }, async s => {
    const scrolledIds: string[] = [];
    await s.page.exposeFunction('recordSearchScroll', (id: string) => { scrolledIds.push(id); });
    await s.page.evaluate(() => {
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        const id = this.getAttribute('data-chat-message-id');
        if (id) void (window as unknown as { recordSearchScroll: (id: string) => Promise<void> }).recordSearchScroll(id);
        return original.apply(this, args);
      };
    });
    for (const [query, id] of [['合成关键词 user', 'user-one'], ['第二个目标关键词', 'other-message']]) {
      await moreEntry(s, '全局搜索 (Ctrl+K)');
      const search = panel(s, 'search');
      await field(search, 'search').fill(query);
      await click(s, search.getByRole('button', { name: new RegExp(query) }));
      await expect.poll(() => scrolledIds.at(-1)).toBe(id);
      const target = s.page.locator(`[data-chat-message-id="${id}"]`);
      await expect.poll(async () => target.evaluate(element => {
        const viewport = element.parentElement!.parentElement!.getBoundingClientRect();
        const message = element.getBoundingClientRect();
        return message.top >= viewport.top && message.bottom <= viewport.bottom;
      })).toBe(true);
    }
    expect((await state(s)).selectedTasks).toEqual(['task-two']);
  });
}, 25000);

it('replays the same mobile share request after a lost receipt and dialog reopening', async () => {
  await withSession('gold', 390, 844, { surface: 'share', ops: [{ reply: 'network' }, {}] }, async s => {
    const first = await createShare(s);
    await awaitUi(s);
    expect(await first.getByRole('alert').count()).toBe(1);
    await click(s, closeControl(first));
    await click(s, s.page.getByRole('button', { name: '重新打开', exact: true }));
    const reopened = await createShare(s);
    await awaitUi(s);
    expect(await field(reopened, 'share').inputValue()).toBe(ORIGIN + '/shared/' + SHARE_ID);
    expect(s.bodies).toHaveLength(2);
    expect(s.bodies[1].operation).toBe(s.bodies[0].operation);
    expect(s.bodies[1].body).toEqual(s.bodies[0].body);
  });
}, 25000);

describe('discovery export layout',()=>{
 it.each((['search','report','share'] as const).flatMap(surface=>THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({surface,theme,width,height})))))('$surface $theme $width x $height has screen bounded readable actions',async({surface,theme,width,height})=>{await withSession(theme,width,height,{surface},async s=>{const p=panel(s,surface);await capture(s,surface+'-'+theme+'-'+width+'x'+height);await panelBounds(p);await target(closeControl(p));for(const b of await p.getByRole('button').all()){await reveal(s,b);await target(b);}if(surface!=='share')expect(await field(p,surface).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'discovery input font').toBeGreaterThanOrEqual(16);});},25000);
});
describe('discovery export semantics',()=>{
 it.each((['search','report','share'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme has named close and associated input',async({surface,theme})=>{await withSession(theme,390,844,{surface},async s=>{const p=panel(s,surface);expect(await p.getByRole('button',{name:'关闭'+({search:'全局搜索',report:'导出报告',share:'分享对话'}[surface]),exact:true}).count(),'discovery named close').toBe(1);if(surface!=='share')expect(await p.getByRole('textbox',{name:surface==='search'?'搜索所有对话内容':'报告标题',exact:true}).count(),'discovery named input').toBe(1);});},25000);
});
describe('discovery export search',()=>{
 it.each(THEMES)('%s searches current supplied conversations and navigates with exact message identity',async theme=>{await withSession(theme,390,844,{surface:'search'},async s=>{const p=panel(s,'search');await field(p,'search').fill('关键词 36');await settle(s.page);const result=p.getByRole('button').filter({hasText:'第二合成会话'});expect(await result.count()).toBe(1);await click(s,result);expect((await state(s)).navigated,'search exact navigation').toEqual([{conversationId:'conv-two',messageId:'result-36'}]);expect((await state(s)).closed).toBe(1);});},25000);
 it.each(THEMES.flatMap(theme=>[false,true].map(empty=>({theme,empty}))))('$theme empty=$empty distinguishes no query and no matches without writes',async({theme,empty})=>{await withSession(theme,390,844,{surface:'search',empty},async s=>{const p=panel(s,'search');expect(await p.getByText('输入关键词搜索历史对话',{exact:true}).count()).toBe(1);await field(p,'search').fill('不存在的条目');await settle(s.page);expect(await p.getByText('未找到匹配内容',{exact:true}).count()).toBe(1);});},25000);
 it.each(THEMES.flatMap(theme=>[[320,640],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height reaches the final long search result with native scrolling',async({theme,width,height})=>{await withSession(theme,width,height,{surface:'search'},async s=>{const p=panel(s,'search');await field(p,'search').fill('关键词');await settle(s.page);const results=p.getByRole('button').filter({hasText:'第二合成会话'});expect(await results.count()).toBe(37);await reveal(s,results.last());await target(results.last());await capture(s,'search-results-'+theme+'-'+width+'x'+height);await click(s,results.last());expect((await state(s)).navigated).toEqual([{conversationId:'conv-two',messageId:'result-36'}]);});},25000);
});
describe('discovery export report',()=>{
 it.each(THEMES)('%s downloads the complete Markdown document and sanitizes the chosen filename',async theme=>{await withSession(theme,390,844,{surface:'report'},async s=>{const p=panel(s,'report');await field(p,'report').fill('报告:移动/设计?');const wait=s.page.waitForEvent('download');await click(s,p.getByRole('button',{name:'下载 Markdown 文件',exact:true}));const download=await wait,stream=await download.createReadStream();if(!stream)throw Error('SC_UI_FIXTURE_DOWNLOAD_STREAM_REQUIRED');const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const doc=Buffer.concat(chunks).toString('utf8');expect(download.suggestedFilename(),'report sanitized filename').toMatch(/^报告_移动_设计__\d{4}-\d{2}-\d{2}\.md$/);expect(doc,'report complete bytes').toMatch(/^# 报告:移动\/设计\?\n\n> 生成时间：[^\n]+\n> 来源：无界AI 智能对话\n\n---\n\n/);expect(doc.slice(doc.indexOf('\n\n---\n\n')+7),'report full content').toBe(CONTENT);expect((await state(s)).closed).toBe(1);});},25000);
 it.each(THEMES)('%s copies every report byte using the native clipboard',async theme=>{await withSession(theme,390,844,{surface:'report'},async s=>{const p=panel(s,'report');await click(s,p.getByRole('button',{name:'发送到 Word 大师（复制内容）',exact:true}));await expect.poll(async()=>(await state(s)).closed).toBe(1);const actual=await s.page.evaluate(()=>navigator.clipboard.readText());expect(actual,'report clipboard complete').toBe(process.platform==='win32'?CONTENT.replaceAll('\n','\r\n'):CONTENT);});},25000);
});
describe('discovery export share',()=>{
 it.each(THEMES)('%s publishes only explicit non-system messages and copies the exact same-origin link',async theme=>{await withSession(theme,390,844,{surface:'share',ops:[{}]},async s=>{const p=await createShare(s);await awaitUi(s);expect(s.bodies.map(b=>b.body),'share exact filtered body').toEqual([{conversationId:'task-one',title:TITLE,messages:[{id:'user-one',role:'user',content:'合成关键词 user',timestamp:1},{id:'answer-one',role:'assistant',content:CONTENT,timestamp:2}]}]);expect(await field(p,'share').inputValue(),'share exact link').toBe(ORIGIN+'/shared/'+SHARE_ID);await reveal(s,p.getByRole('button',{name:'复制',exact:true}));await target(p.getByRole('button',{name:'复制',exact:true}));await click(s,p.getByRole('button',{name:'复制',exact:true}));await expect.poll(()=>s.page.evaluate(()=>navigator.clipboard.readText())).toBe(ORIGIN+'/shared/'+SHARE_ID);});},25000);
 it.each(THEMES)('%s explains the actual non-system message count before publication',async theme=>{await withSession(theme,390,844,{surface:'share'},async s=>{const p=panel(s,'share');expect(await p.getByText(/此对话的 2 条消息/).count(),'share disclosed message count').toBe(1);});},25000);
 it.each((['http','network','invalid-json','invalid-object','external','mismatched'] as const).flatMap(reply=>THEMES.map(theme=>({reply,theme}))))('$theme $reply never displays an invalid publication as successful',async({reply,theme})=>{await withSession(theme,390,844,{surface:'share',ops:[{reply}]},async s=>{const p=await createShare(s);await awaitUi(s);expect(await p.getByRole('alert').count(),'share visible failure').toBe(1);expect(await p.locator('input').count(),'share invalid receipt has no link').toBe(0);expect(await p.getByText('分享链接已创建，有效期 30 天：',{exact:true}).count(),'share invalid receipt not successful').toBe(0);});},25000);
 it.each(THEMES)('%s freezes an in-flight publication and does not toast late failure into a reopened dialog',async theme=>{await withSession(theme,390,844,{surface:'share',ops:[{reply:'http',hold:true}]},async s=>{const p=await createShare(s);await expect.poll(()=>s.gates.length).toBe(1);expect(await p.getByRole('button',{name:'创建中...',exact:true}).isDisabled()).toBe(true);await click(s,closeControl(p));await click(s,s.page.getByRole('button',{name:'重新打开',exact:true}));s.gates[0].release();await awaitUi(s);expect(await s.page.locator('[data-sonner-toast]').count(),'share no late toast').toBe(0);expect(await panel(s,'share').getByRole('button',{name:'创建分享链接',exact:true}).count()).toBe(1);});},25000);
});
describe('discovery export keyboard',()=>{
 it.each((['search','report','share'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme contains keyboard focus and closes with Escape',async({surface,theme})=>{await withSession(theme,390,844,{surface},async s=>{const p=panel(s,surface);for(let i=0;i<7;i++){await s.page.keyboard.press('Tab');expect(await p.evaluate(e=>e.contains(document.activeElement)),'discovery focus inside').toBe(true);}await s.page.keyboard.press('Escape');await settle(s.page);expect((await state(s)).closed,'discovery Escape closes').toBe(1);});},25000);
});
describe('discovery export parent',()=>{
 it.each(THEMES)('%s opens current-project search and switches to its exact task without persistence writes',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const composer=s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true});await composer.click();await s.page.keyboard.press('Control+k');await settle(s.page);const p=panel(s,'search');await field(p,'search').fill('第二个目标关键词');await settle(s.page);await click(s,p.getByRole('button').filter({hasText:'第二合成对话'}));expect((await state(s)).selectedTasks).toEqual(['task-two']);});},25000);
});
describe('discovery export contrast',()=>{
 it.each((['search','report','share'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme keeps enabled actions and input text readable',async({surface,theme})=>{await withSession(theme,390,844,{surface},async s=>{const p=panel(s,surface);const controls=surface==='search'?[field(p,surface)]:surface==='report'?[field(p,surface),p.getByRole('button',{name:'下载 Markdown 文件',exact:true})]:[p.getByRole('button',{name:'创建分享链接',exact:true})];const values=[];for(const c of controls){await reveal(s,c);const ratio=await textContrast(c,surface==='search');values.push({text:await c.getAttribute('placeholder')||await c.textContent(),ratio});expect(ratio,'discovery text contrast').toBeGreaterThanOrEqual(4.5);}console.log('SC_DISCOVERY_CONTRAST',JSON.stringify({surface,theme,values}));});},25000);
});

describe('discovery export clipboard failure',()=>{
 it.each((['report','share'] as const).flatMap(surface=>THEMES.map(theme=>({surface,theme}))))('$surface $theme shows a visible rejection instead of leaking an uncaught clipboard failure',async({surface,theme})=>{await withSession(theme,390,844,{surface,clipboardDenied:true,ops:surface==='share'?[{}]:[]},async s=>{const p=surface==='share'?await createShare(s):panel(s,'report');if(surface==='share')await awaitUi(s);await click(s,p.getByRole('button',{name:surface==='share'?'复制':'发送到 Word 大师（复制内容）',exact:true}));await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).clipboardFixture.pending===0);await settle(s.page);expect(await p.getByRole('alert').count(),'clipboard visible rejection').toBe(1);expect((await state(s)).closed,'clipboard failure remains open').toBe(0);});},25000);
});
describe('discovery export report late',()=>{
 it.each(THEMES.flatMap(theme=>[false,true].map(clipboardDenied=>({theme,clipboardDenied}))))('$theme rejected=$clipboardDenied ignores the old clipboard completion after close and reopen',async({theme,clipboardDenied})=>{await withSession(theme,390,844,{surface:'report',clipboardHold:true,clipboardDenied},async s=>{const p=panel(s,'report');await click(s,p.getByRole('button',{name:'发送到 Word 大师（复制内容）',exact:true}));await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.pending)).toBe(1);expect(await p.getByRole('button',{name:'发送到 Word 大师（复制内容）',exact:true}).isDisabled(),'report pending copy disabled').toBe(true);await click(s,closeControl(p));await click(s,s.page.getByRole('button',{name:'重新打开',exact:true}));await s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.release());await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).clipboardFixture.pending===0);await settle(s.page);expect((await state(s)).closed,'report late does not close new panel').toBe(1);expect(await s.page.locator('[data-sonner-toast]').count(),'report no late toast').toBe(0);expect(await panel(s,'report').count(),'report fresh panel remains').toBe(1);});},25000);
});
describe('discovery export share copy late',()=>{
 it.each(THEMES)('%s blocks repeated copy while pending and ignores late copy status after close',async theme=>{await withSession(theme,390,844,{surface:'share',clipboardHold:true,ops:[{}]},async s=>{const p=await createShare(s);await awaitUi(s);await click(s,p.getByRole('button',{name:'复制',exact:true}));await expect.poll(()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.pending)).toBe(1);const copy=p.getByRole('button',{name:/复制/}).last();expect(await copy.isDisabled(),'share pending copy disabled').toBe(true);await click(s,closeControl(p));await click(s,s.page.getByRole('button',{name:'重新打开',exact:true}));await s.page.evaluate(()=>(window as unknown as FixtureWindow).clipboardFixture.release());await s.page.waitForFunction(()=>(window as unknown as FixtureWindow).clipboardFixture.pending===0);await settle(s.page);expect(await s.page.locator('[data-sonner-toast]').count(),'share no late copy toast').toBe(0);expect((await state(s)).closed).toBe(1);});},25000);
});
describe('discovery export parent other',()=>{
 it.each(THEMES.flatMap(theme=>(['report','share'] as const).map(surface=>({theme,surface}))))('$theme $surface receives current task data from the real ChatArea',async({theme,surface})=>{await withSession(theme,390,844,{surface:'chat',ops:surface==='share'?[{}]:[]},async s=>{await moreEntry(s,surface==='share'?'分享对话':'导出分析报告');const p=panel(s,surface);await panelBounds(p);if(surface==='share'){await createShare(s);await awaitUi(s);expect(await field(p,'share').inputValue()).toBe(ORIGIN+'/shared/'+SHARE_ID);}else{expect(await field(p,'report').inputValue(),'parent report title').toBe(TITLE);expect(await p.getByText('共 '+CONTENT.length+' 字符',{exact:true}).count(),'parent complete report content').toBe(1);}await s.page.keyboard.press('Escape');await settle(s.page);expect(await p.count(),'parent Escape closes').toBe(0);});},25000);
});
describe('discovery export fixture boundary',()=>{
  it('rejects a missing promised POST instead of passing an unsubmitted operation',async()=>{const s=await session('gold',390,844,{surface:'share',ops:[{}]});await expect(dispose(s)).rejects.toThrow('SC_UI_FIXTURE_REQUEST_VALIDATION');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{const s=await session('gold',390,844,{surface:'share'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}},25000);
  it.each(['http','websocket'] as const)('preserves a cleanup failure alongside expected %s refusal',async transport=>{const s=await session('gold',390,844,{surface:'share'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});

describe('discovery export completion branches',()=>{
 it.each(THEMES)('%s restores the real composer focus after keyboard search closes',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const composer=s.page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true});await composer.click();await s.page.keyboard.press('Control+k');await settle(s.page);expect(await panel(s,'search').count()).toBe(1);await s.page.keyboard.press('Escape');await settle(s.page);expect(await panel(s,'search').count(),'search closes before return focus').toBe(0);await expect.poll(()=>composer.evaluate(e=>document.activeElement===e)).toBe(true);});},25000);
 it.each(THEMES)('%s ignores a successful old share receipt after closing and reopening',async theme=>{await withSession(theme,390,844,{surface:'share',ops:[{hold:true}]},async s=>{const p=await createShare(s);await expect.poll(()=>s.gates.length).toBe(1);await click(s,closeControl(p));await click(s,s.page.getByRole('button',{name:'重新打开',exact:true}));s.gates[0].release();await awaitUi(s);const fresh=panel(s,'share');expect(await fresh.locator('input').count(),'old share success must not inject link').toBe(0);expect(await fresh.getByRole('button',{name:'创建分享链接',exact:true}).count()).toBe(1);expect(await s.page.locator('[data-sonner-toast]').count(),'old share success has no toast').toBe(0);expect((await state(s)).closed).toBe(1);});},25000);
});
