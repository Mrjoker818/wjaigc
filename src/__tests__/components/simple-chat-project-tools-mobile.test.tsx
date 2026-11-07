// @vitest-environment node
// Production project search/Skill book/usage and real ChatArea/Providers/CSS; only synthetic .invalid I/O.
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type Request} from '@playwright/test';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';

type Theme='gold'|'mono';
type Surface='usage'|'chat';
type Reply='ok'|'http'|'network'|'invalid-json'|'invalid-object'|'external'|'mismatched';
interface Operation{reply?:Reply;hold?:boolean}
interface Options{surface?:Surface;zero?:boolean;large?:boolean;ops?:Operation[];clipboardDenied?:boolean;clipboardHold?:boolean}
interface Gate{wait:Promise<void>;release():void}
interface FixtureWindow extends Window{scUi:{mount(theme:Theme,options:Options):void;unmount():void;state:{disposed:boolean;closed:number;selectedTasks:string[];selectedSkills:string[];catalog:Array<{id:string;name:string;description:string;tags:string[]}>}};clipboardFixture:{release():void;pending:number}}
interface Session{context:BrowserContext;page:Page;options:Options;errors:string[];counts:Map<string,number>;handlers:Set<Promise<void>>;pending:Set<Request>;completed:Set<Request>;failed:Set<Request>;refused:Set<Request>;plannedFailed:Set<Request>;nativeWaiters:Set<()=>void>;gates:Gate[];mounted:boolean;consumed:Set<number>;bodies:Array<{path:string;body:Record<string,unknown>}>}
const ORIGIN='https://simple-chat-project-tools-mobile.invalid';
const THEMES:Theme[]=['gold','mono'];
const MODEL_FIXTURE=[{id:'synthetic-model',providerId:'synthetic-provider',displayName:'合成模型',providerName:'合成供应商'}];
const ENTRY="\nimport React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport ChatArea from '@/components/simple-chat/chat-area';\nimport {UsageStats} from '@/components/simple-chat/usage-stats';\nimport {PRESET_SKILLS,type SimpleChatProject,type SimpleChatTask} from '@/components/simple-chat/simple-chat-types';\nimport {Providers,useTheme} from '@/app/simple-chat/providers';\nimport {Toaster} from 'sonner';\nconst TITLE='合成项目内消息'+('长标题'.repeat(22));\nconst tasks:SimpleChatTask[]=[{id:'task-one',projectId:'project-one',name:TITLE,messages:[{id:'message-one',role:'user',content:'关键词 当前对话',createdAt:1},{id:'message-two',role:'assistant',content:'普通合成回复',createdAt:2}],model:'',providerId:'',createdAt:1,updatedAt:1},{id:'task-two',projectId:'project-one',name:'第二个合成任务'+('长名称'.repeat(22)),messages:Array.from({length:38},(_,i)=>({id:'other-'+i,role:'user' as const,content:'关键词 OTHER '+i+' https://result.invalid/'+('longurl'.repeat(30)),createdAt:3+i})),model:'',providerId:'',createdAt:1,updatedAt:1}];\nconst seed:SimpleChatProject={id:'project-one',name:'合成项目',createdAt:1,updatedAt:1,agents:[],knowledgeItems:[],tasks};\nconst user={id:'synthetic-mobile-user',name:'仅本地界面合成用户',role:'user' as const,status:'active' as const,productType:'chat' as const,createdAt:1,updatedAt:1};\nconst root=createRoot(document.getElementById('fixture-root')!);let mounted=false;\nconst state={disposed:false,closed:0,navigated:[],selectedTasks:[] as string[],selectedSkills:[] as string[],catalog:PRESET_SKILLS};\nfunction Entry({options}:{options:{surface?:'usage'|'chat';zero?:boolean;large?:boolean}}){\n const [project,setProject]=useState(seed),[active,setActive]=useState('task-one'),[open,setOpen]=useState(true);const {theme}=useTheme();\n const close=()=>{state.closed++;setOpen(false);};const unavailable=()=>{throw Error('SC_UI_FIXTURE_UNEXPECTED_WRITE');};\n const usage=options.zero?{prompt:0,completion:0,total:0}:options.large?{prompt:9876543210,completion:1234567890,total:11111111100}:{prompt:1200,completion:800,total:2000};\n return <div className=\"h-full w-full min-w-0 overflow-hidden\">{options.surface==='usage'?(open?<UsageStats usage={usage} messageCount={options.zero?0:options.large?1234567890:4} imageCount={options.zero?0:options.large?9876543210:2} isMonochrome={theme!=='dark'} onClose={close}/>:<button className=\"min-h-11 min-w-11\" onClick={()=>setOpen(true)}>重新打开</button>):<ChatArea user={user} project={project} task={project.tasks.find(t=>t.id===active)!} onUpdateTask={(task:SimpleChatTask)=>setProject(p=>({...p,tasks:p.tasks.map(t=>t.id===task.id?task:t)}))} onPersistTask={async()=>{unavailable();}} onUpdateProject={setProject} onCreateTask={unavailable} onSelectTask={(task)=>{state.selectedTasks.push(task.id);setActive(task.id);}} onUpdateAgent={unavailable} onDeleteAgent={unavailable} onSkillToAgent={skill=>state.selectedSkills.push(skill.id)} onLogout={unavailable} onBackToWorkspace={unavailable} sidebarOpen={false} onToggleSidebar={unavailable}/>}<Toaster/></div>;\n}\nObject.assign(window,{scUi:{state,mount(theme:'gold'|'mono',options:{surface?:'usage'|'chat';zero?:boolean;large?:boolean}){if(mounted||state.disposed)throw Error('SC_UI_FIXTURE_REMOUNT');mounted=true;localStorage.setItem('simple-chat-theme',theme==='mono'?'light':'dark');root.render(<Providers><Entry options={options}/></Providers>);},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});\n";
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
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'simple-chat-project-tools-mobile-entry.tsx' },
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



const keyOf=(r:Request):string=>r.method()+' '+new URL(r.url()).pathname+new URL(r.url()).search;
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
   throw Error('SC_UI_FIXTURE_UNKNOWN_HTTP '+key);
  })().catch(async e=>{s.errors.push(String(e));s.refused.add(route.request());await route.abort('blockedbyclient');});s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);}});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});
  await page.addInitScript(({deny,hold})=>{let release=():void=>{};const wait=new Promise<void>(r=>{release=r;});const fixture={release,pending:0};Object.assign(window,{clipboardFixture:fixture});if(deny||hold){const original=navigator.clipboard.writeText.bind(navigator.clipboard);Object.defineProperty(navigator.clipboard,'writeText',{value:async(text:string)=>{fixture.pending++;try{if(hold)await wait;if(deny)throw new DOMException('合成剪贴板拒绝','NotAllowedError');await original(text);}finally{fixture.pending--;}}});}},{deny:!!options.clipboardDenied,hold:!!options.clipboardHold});
  await page.goto(ORIGIN);await page.addScriptTag({content:bundle});await page.evaluate(({theme,options})=>(window as unknown as FixtureWindow).scUi.mount(theme,options),{theme,options});s.mounted=true;
  await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===(t==='mono'?'light':'dark'),theme,{timeout:1500});
  if(options.surface==='chat'){await page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片',{exact:true}).waitFor();await nativeRequestsFinished(s);}
  else await page.getByText('用量统计',{exact:true}).waitFor();await settle(page);return s;
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
async function capture(s:Session,name:string):Promise<void>{const directory=path.resolve('output/playwright/simple-chat-project-tools-native-20261018',String(process.pid));await mkdir(directory,{recursive:true});const file=path.join(directory,name+'.png');await s.page.screenshot({path:file});console.log('SC_UI_NATIVE_CAPTURE',JSON.stringify({path:file,physicalAndroid:false,coze:false}));}
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



type Tool='search'|'skills'|'usage';
const title=(tool:Tool):string=>tool==='search'?'项目内搜索':tool==='skills'?'Skill 书':'用量统计';
const panel=(s:Session,tool:Tool):Locator=>s.page.getByText(title(tool),{exact:true}).locator('xpath=ancestor::*[@data-slot="dialog-content" or contains(@class,"shadow-2xl")][1]');
const closeControl=(p:Locator):Locator=>p.locator(':scope > div').first().getByRole('button').last();
const field=(s:Session):Locator=>s.page.getByPlaceholder('搜索消息内容...',{exact:true});
async function moreEntry(s:Session,label:string):Promise<void>{const settings=s.page.getByRole('button',{name:'更多设置',exact:true});if(await settings.count()&&await settings.getAttribute('aria-expanded')==='false')await click(s,settings);await click(s,s.page.getByTitle(label,{exact:true}));}
async function openTool(s:Session,tool:Tool):Promise<Locator>{if(tool==='skills')await click(s,s.page.getByTitle('Skill',{exact:true}));else await moreEntry(s,tool==='search'?'项目内搜索':'用量统计');await s.page.getByText(title(tool),{exact:true}).waitFor();return panel(s,tool);}
const state=(s:Session)=>s.page.evaluate(()=>(window as unknown as FixtureWindow).scUi.state);

describe('project tools layout',()=>{
 it.each((['search','skills','usage'] as const).flatMap(tool=>THEMES.flatMap(theme=>[[320,640],[390,844],[640,320],[1440,900]].map(([width,height])=>({tool,theme,width,height})))))('$tool $theme $width x $height is bounded with operable controls',async({tool,theme,width,height})=>{await withSession(theme,width,height,{surface:tool==='usage'?'usage':'chat',large:tool==='usage'},async s=>{const p=tool==='usage'?panel(s,tool):await openTool(s,tool);if(tool==='search'){await field(s).fill('关键词');await field(s).press('Enter');await settle(s.page);}await capture(s,tool+'-'+theme+'-'+width+'x'+height);await panelBounds(p);if(tool==='usage'){const leaks=await p.locator('.grid > div').evaluateAll(es=>es.map(e=>Math.max(...[e,...e.querySelectorAll('div,span')].map(n=>n.scrollWidth-n.clientWidth))));expect(Math.max(...leaks),'project tools usage numeric cells do not overflow').toBeLessThanOrEqual(1);}await target(closeControl(p));const controls=await p.getByRole('button').all();for(const b of controls){await reveal(s,b);await target(b);}if(tool==='search')expect(await field(s).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'project tools input font').toBeGreaterThanOrEqual(16);});},25000);
});
describe('project tools semantics',()=>{
 it.each((['search','skills','usage'] as const).flatMap(tool=>THEMES.map(theme=>({tool,theme}))))('$tool $theme named dialog and close',async({tool,theme})=>{await withSession(theme,390,844,{surface:tool==='usage'?'usage':'chat'},async s=>{const p=tool==='usage'?panel(s,tool):await openTool(s,tool);expect(await p.getAttribute('role'),'project tools dialog role').toBe('dialog');expect(await closeControl(p).getAttribute('aria-label'),'project tools named close').toBe('关闭'+title(tool));if(tool==='search')expect(await field(s).getAttribute('aria-label'),'project tools named input').toBe('搜索项目消息');});},25000);
});
describe('project tools keyboard',()=>{
 it.each((['search','skills','usage'] as const).flatMap(tool=>THEMES.map(theme=>({tool,theme}))))('$tool $theme traps focus and Escape closes',async({tool,theme})=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,tool);expect(await p.evaluate(e=>e.contains(document.activeElement)),'project tools focus inside').toBe(true);for(let i=0;i<6;i++){await s.page.keyboard.press(i%2?'Shift+Tab':'Tab');expect(await p.evaluate(e=>e.contains(document.activeElement)),'project tools focus inside').toBe(true);}await s.page.keyboard.press('Escape');await settle(s.page);expect(await s.page.getByText(title(tool),{exact:true}).count(),'project tools Escape closes').toBe(0);expect(await s.page.evaluate(()=>document.activeElement?.tagName),'project tools restored focus is actionable').toBe('BUTTON');expect(await s.page.evaluate(()=>document.activeElement?.getAttribute('title')),'project tools restores exact trigger').toBe(tool==='skills'?'Skill':null);if(tool!=='skills'){expect(await s.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'project tools restored visible settings fallback').toBe('更多设置');await target(s.page.getByRole('button',{name:'更多设置',exact:true}));}});},25000);
});
describe('project tools search state',()=>{
 it.each(THEMES)('%s clear after submit removes old results',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'search');await field(s).fill('关键词');await field(s).press('Enter');await settle(s.page);expect(await p.getByRole('button').count()).toBe(41);await field(s).fill('');await field(s).press('Enter');await settle(s.page);expect(await p.getByRole('button').count(),'project tools cleared search has no stale results').toBe(2);});},25000);
 it.each(THEMES)('%s editing query invalidates old results until submitted',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'search');await field(s).fill('关键词');await field(s).press('Enter');await settle(s.page);await field(s).fill('不存在的合成文本');await settle(s.page);expect(await p.getByRole('button').count(),'project tools draft has no stale results').toBe(2);});},25000);
 it.each(THEMES)('%s no match is shown only after submitted',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'search');await field(s).fill('不存在的合成文本');await settle(s.page);expect(await p.getByText('未找到匹配结果',{exact:true}).count(),'project tools unsubmitted is not failed search').toBe(0);await field(s).press('Enter');await settle(s.page);expect(await p.getByText('未找到匹配结果',{exact:true}).count()).toBe(1);});},25000);
 it.each(THEMES)('%s other task remains selectable after native scrolling',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'search');await field(s).fill('other');await field(s).press('Enter');await settle(s.page);expect(await p.getByRole('button').count()).toBe(40);await click(s,p.getByRole('button').last());expect((await state(s)).selectedTasks).toEqual(['task-two']);expect(await s.page.getByText('项目内搜索',{exact:true}).count()).toBe(0);});},25000);
 it.each(THEMES)('%s current task result closes without redundant task selection',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'search');await field(s).fill('当前对话');await field(s).press('Enter');await settle(s.page);await click(s,p.getByRole('button').last());expect((await state(s)).selectedTasks).toEqual([]);expect(await s.page.getByText('项目内搜索',{exact:true}).count()).toBe(0);});},25000);
 it.each(THEMES)('%s result is still usable after close and reopen with no new query',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{let p=await openTool(s,'search');await field(s).fill('当前对话');await field(s).press('Enter');await settle(s.page);await click(s,closeControl(p));p=await openTool(s,'search');expect(await field(s).inputValue()).toBe('当前对话');expect(await p.getByRole('button').count()).toBe(3);});},25000);
});
describe('project tools skill selection',()=>{
 it.each(THEMES)('%s keeps every actual preset and passes exact selected id once',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'skills'),catalog=(await state(s)).catalog;const listed=await p.locator('[data-simple-chat-skill-id]').evaluateAll(es=>es.map(e=>e.getAttribute('data-simple-chat-skill-id')));expect(listed).toEqual(catalog.map(x=>x.id));for(const item of catalog){const b=p.locator('[data-simple-chat-skill-id="'+item.id+'"]');expect(await b.innerText()).toContain(item.name);expect(await b.innerText()).toContain(item.description);for(const tag of item.tags)expect(await b.innerText()).toContain(tag);}await click(s,p.locator('[data-simple-chat-skill-id]').last());expect(await s.page.getByText('Skill 书',{exact:true}).count()).toBe(0);expect(await s.page.locator('[data-simple-chat-selected-skill="'+catalog.at(-1)!.id+'"]').count()).toBe(1);expect((await state(s)).selectedSkills).toEqual([]);await click(s,s.page.getByRole('button',{name:'存为 Agent',exact:true}));expect((await state(s)).selectedSkills).toEqual([catalog.at(-1)!.id]);});},25000);
});
describe('project tools usage data',()=>{
 it.each(THEMES.flatMap(theme=>['zero','normal','large'].map(data=>({theme,data}))))('$theme $data retains counts bars and original arithmetic',async({theme,data})=>{await withSession(theme,390,844,{surface:'usage',zero:data==='zero',large:data==='large'},async s=>{const p=panel(s,'usage');const total=data==='zero'?0:data==='large'?11111111100:2000;const prompt=data==='zero'?0:data==='large'?9876543210:1200;const completion=data==='zero'?0:data==='large'?1234567890:800;const count=data==='zero'?0:data==='large'?1234567890:4;expect(await p.innerText()).toContain(total.toLocaleString('zh-CN'));expect(await p.innerText()).toContain((count?Math.round(total/count):0).toLocaleString('zh-CN')+' tokens');expect(await p.innerText()).toContain('$'+(total/1000*0.005).toFixed(4));const widths=await p.locator('[style*="width"]').evaluateAll(es=>es.map(e=>(e as HTMLElement).style.width));expect(widths.map(Number.parseFloat)).toEqual([prompt/Math.max(prompt,completion,1)*100,completion/Math.max(prompt,completion,1)*100].map(x=>Number.parseFloat(x.toFixed(4))));await panelBounds(p);});},25000);
 it.each(THEMES)('%s real parent derives two messages zero images and no token calls',async theme=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,'usage');expect(await p.getByText('消息数',{exact:true}).locator('..').innerText()).toContain('2');expect(await p.getByText('图片数',{exact:true}).locator('..').innerText()).toContain('0');expect(await p.getByText('总 Tokens',{exact:true}).locator('..').innerText()).toContain('0');});},25000);
});
describe('project tools contrast',()=>{
 it.each((['search','skills','usage'] as const).flatMap(tool=>THEMES.map(theme=>({tool,theme}))))('$tool $theme keeps enabled text readable',async({tool,theme})=>{await withSession(theme,390,844,{surface:tool==='usage'?'usage':'chat'},async s=>{const p=tool==='usage'?panel(s,tool):await openTool(s,tool);const controls=tool==='search'?[field(s),p.getByRole('button',{name:'搜索',exact:true})]:tool==='skills'?[p.locator('[data-simple-chat-skill-id]').first().locator('div > div').nth(1)]:[p.getByText('统计数据基于当前对话会话，仅供参考',{exact:true})];for(const control of controls){const ratio=await textContrast(control,tool==='search'&&control===controls[0]);console.log('PROJECT_TOOLS_CONTRAST',JSON.stringify({tool,theme,ratio}));expect(ratio,'project tools text contrast').toBeGreaterThanOrEqual(4.5);}});},25000);
});
describe('project tools fixture boundary',()=>{
  it('rejects a missing promised POST instead of passing an unsubmitted operation',async()=>{const s=await session('gold',390,844,{surface:'usage',ops:[{}]});await expect(dispose(s)).rejects.toThrow('SC_UI_FIXTURE_REQUEST_VALIDATION');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);},25000);
  it.each(['http','websocket'] as const)('refuses unknown %s as infrastructure',async transport=>{const s=await session('gold',390,844,{surface:'usage'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'SC_UI_FIXTURE_INFRASTRUCTURE: Error: SC_UI_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SC_UI_FIXTURE_INFRASTRUCTURE: SC_UI_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}},25000);
  it.each(['http','websocket'] as const)('preserves a cleanup failure alongside expected %s refusal',async transport=>{const s=await session('gold',390,844,{surface:'usage'});try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{/* deliberate refusal */}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SC_UI_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('SC_UI_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('SC_UI_FIXTURE_CLEANUP_FAILURE: Error: SC_UI_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});




describe('project tools focus followup',()=>{
 it.each((['search','skills','usage'] as const).flatMap(tool=>THEMES.map(theme=>({tool,theme}))))('$tool $theme actually wraps both keyboard focus boundaries',async({tool,theme})=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,tool),first=closeControl(p),last=p.getByRole('button').last();expect(await first.evaluate(e=>e===document.activeElement),'project tools focus initial close').toBe(true);await s.page.keyboard.press('Shift+Tab');expect(await last.evaluate(e=>e===document.activeElement),'project tools focus last boundary').toBe(true);await s.page.keyboard.press('Tab');expect(await first.evaluate(e=>e===document.activeElement),'project tools focus first boundary').toBe(true);});},25000);
 it.each((['search','usage'] as const).flatMap(tool=>THEMES.map(theme=>({tool,theme}))))('$tool $theme returns to visible settings button after content click hides entry',async({tool,theme})=>{await withSession(theme,390,844,{surface:'chat'},async s=>{const p=await openTool(s,tool);await click(s,p.getByText(title(tool),{exact:true}));expect(await s.page.locator('button[aria-label="更多设置"]').getAttribute('aria-expanded')).toBe('false');await click(s,closeControl(p));expect(await s.page.getByText(title(tool),{exact:true}).count()).toBe(0);expect(await s.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'project tools focus returns to visible fallback').toBe('更多设置');await target(s.page.getByRole('button',{name:'更多设置',exact:true}));});},25000);
});
