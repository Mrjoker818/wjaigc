// @vitest-environment node
// Real ChatPanel, shared SkillInputFields and shipped styles in Chromium. Synthetic HTTP only, never
// a saved browser profile, business account, real model or cloned UI.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

type Theme = 'gold' | 'mono';
interface Options { surface: 'fields' | 'chat' | 'group'; touch?: boolean; disabled?: boolean; requiredProbe?: boolean; longCategory?: boolean; outer?: boolean }
interface FixtureWindow extends Window { skillMobile: { mount(theme: Theme, options: Options): void; unmount(): void; state: { values: Record<string, unknown>; disposed: boolean }; catalog: SkillDefinition[]; group: { urls: string[]; previews: string[]; updates: number; mounts: number; nodeId: string }; updateGroup(urls: string[]): void } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean }
const ORIGIN = 'https://skill-mobile-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = "\nimport React,{useState,useEffect} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {ChatPanel} from '@/components/chat-panel';\nimport {SkillInputFields} from '@/components/skill-runtime/SkillInputFields';\nimport {listSkillsForSurface,CANVAS_WORKFLOW_SKILLS} from '@/lib/skill-runtime/catalog';\nimport type {SkillInputField} from '@/lib/skill-runtime/types';\nimport {WorkflowLegacyNodeCard} from '@/components/workflow/WorkflowLegacyNodeCard';\nimport {createWorkflowNode} from '@/lib/workflow-engine';\nconst rbThemes={\"gold\":{\"sidebarBg\":\"#161b22\",\"sidebarBorder\":\"rgba(212,175,55,0.15)\",\"sidebarText\":\"#f0f6fc\",\"sidebarMuted\":\"#8b949e\",\"sidebarDimmed\":\"#484f58\",\"nodeBg\":\"#161b22\",\"nodeBorder\":\"rgba(212,175,55,0.3)\",\"nodeSelectedBorder\":\"var(--ne-accent)\",\"nodeHoverBg\":\"#1c2128\",\"nodeHeaderText\":\"#f0f6fc\",\"nodePortText\":\"#8b949e\",\"nodeBody\":\"#0d1117\",\"nodeSelected\":\"#1c2128\",\"nodeTitle\":\"#f0f6fc\",\"portFill\":\"#161b22\",\"portLabel\":\"#8b949e\",\"badgeText\":\"#000\",\"gridDot\":\"#21262d\",\"danger\":\"#f85149\",\"success\":\"#3fb950\",\"arrowFill\":\"#484f58\",\"accent\":\"#d4af37\",\"accentHover\":\"#c9a02e\",\"accentDim\":\"rgba(212,175,55,0.15)\",\"accentMuted\":\"rgba(212,175,55,0.25)\",\"cardBg\":\"#1c2128\",\"cardBorder\":\"rgba(212,175,55,0.15)\",\"border\":\"rgba(48,54,61,0.6)\",\"text\":\"#f0f6fc\",\"textMuted\":\"#8b949e\",\"inputBg\":\"rgba(13,17,23,0.9)\",\"inputBorder\":\"rgba(48,54,61,0.8)\",\"inputText\":\"#f0f6fc\",\"inputPlaceholder\":\"#484f58\",\"optionBg\":\"#21262d\",\"optionText\":\"#f0f6fc\",\"btnBg\":\"rgba(212,175,55,0.1)\",\"btnHoverBg\":\"rgba(212,175,55,0.2)\",\"btnText\":\"var(--ne-accent)\",\"canvasBg\":\"#0d1117\",\"canvasGrid\":\"rgba(48,54,61,0.3)\",\"canvasDot\":\"rgba(48,54,61,0.5)\",\"connColor\":\"#30363d\",\"connHighlight\":\"var(--ne-accent)\",\"toolbarBg\":\"#161b22\",\"toolbarBorder\":\"rgba(48,54,61,0.6)\",\"toolbarText\":\"#8b949e\",\"tabActiveBg\":\"rgba(212,175,55,0.15)\",\"tabActiveText\":\"var(--ne-accent)\",\"tabInactiveText\":\"#484f58\",\"statusRunning\":\"#58a6ff\",\"statusSuccess\":\"#3fb950\",\"statusError\":\"#f85149\",\"scrollbarTrack\":\"#111\",\"scrollbarThumb\":\"rgba(212,175,55,0.2)\"},\"monochrome\":{\"sidebarBg\":\"#f8fafc\",\"sidebarBorder\":\"#e2e8f0\",\"sidebarText\":\"#1e293b\",\"sidebarMuted\":\"#64748b\",\"sidebarDimmed\":\"#94a3b8\",\"nodeBg\":\"#ffffff\",\"nodeBorder\":\"#cbd5e1\",\"nodeSelectedBorder\":\"#3b82f6\",\"nodeHoverBg\":\"#f1f5f9\",\"nodeHeaderText\":\"#1e293b\",\"nodePortText\":\"#64748b\",\"nodeTitleText\":\"#334155\",\"nodeBody\":\"#f8fafc\",\"nodeSelected\":\"#e2e8f0\",\"nodeTitle\":\"#334155\",\"portFill\":\"#e2e8f0\",\"portLabel\":\"#64748b\",\"badgeText\":\"#ffffff\",\"gridDot\":\"#cbd5e1\",\"danger\":\"#ef4444\",\"success\":\"#22c55e\",\"arrowFill\":\"#94a3b8\",\"accent\":\"#3b82f6\",\"accentHover\":\"#2563eb\",\"accentDim\":\"rgba(59,130,246,0.08)\",\"accentMuted\":\"rgba(59,130,246,0.15)\",\"cardBg\":\"#ffffff\",\"cardBorder\":\"#e2e8f0\",\"border\":\"#e2e8f0\",\"text\":\"#1e293b\",\"textMuted\":\"#64748b\",\"inputBg\":\"#f1f5f9\",\"inputBorder\":\"#e2e8f0\",\"inputText\":\"#1e293b\",\"inputPlaceholder\":\"#94a3b8\",\"optionBg\":\"#ffffff\",\"optionText\":\"#1e293b\",\"btnBg\":\"rgba(59,130,246,0.08)\",\"btnHoverBg\":\"rgba(59,130,246,0.15)\",\"btnText\":\"#3b82f6\",\"canvasBg\":\"#f0f4f8\",\"canvasGrid\":\"rgba(0,0,0,0.03)\",\"canvasDot\":\"rgba(0,0,0,0.06)\",\"connColor\":\"#94a3b8\",\"connHighlight\":\"#3b82f6\",\"toolbarBg\":\"#ffffff\",\"toolbarBorder\":\"#e2e8f0\",\"toolbarText\":\"#64748b\",\"tabActiveBg\":\"rgba(59,130,246,0.08)\",\"tabActiveText\":\"#3b82f6\",\"tabInactiveText\":\"#94a3b8\",\"statusRunning\":\"#3b82f6\",\"statusSuccess\":\"#22c55e\",\"statusError\":\"#ef4444\",\"scrollbarTrack\":\"#f1f5f9\",\"scrollbarThumb\":\"rgba(59,130,246,0.2)\"}};\nconst groupState={urls:[] as string[],previews:[] as string[],updates:0,mounts:0,nodeId:'rb-group-node'};\nlet groupSetter:((urls:string[])=>void)|undefined;\nconst groupNode=createWorkflowNode('output-image-group',16,16,'RB 结果图片组');groupNode.id=groupState.nodeId;\nfunction GroupHost({theme}:{theme:'gold'|'mono'}):React.ReactElement{\n const [result,setResult]=useState({status:'success',output:{imageUrls:[...groupState.urls]}});\n groupState.urls=result.output.imageUrls;\n groupSetter=(urls:string[])=>{groupState.updates++;setResult({status:'success',output:{imageUrls:[...urls]}});};\n useEffect(()=>{groupState.mounts++;},[]);\n const T=rbThemes[theme==='mono'?'monochrome':'gold'];\n const noop=()=>{};\n return <div className=\"node-editor-root h-dvh w-full\" data-theme={theme==='mono'?'monochrome':'gold'} style={{background:T.canvasBg}}>\n <WorkflowLegacyNodeCard key=\"rb-stable-group\" node={groupNode} isSelected={true} isHighlighted={false} isHovered={false} isRunning={false} theme={T}\n execResult={result} onSelect={noop} onHover={noop} onDragStart={noop} onPortMouseDown={noop} onPortMouseUp={noop} onDelete={noop} onDeselect={noop}\n onPreviewImage={(url:string)=>{groupState.previews.push(url);}}/>\n </div>;\n}\nconst root=createRoot(document.getElementById('fixture-root')!);\nconst fields:readonly SkillInputField[]=[\n {key:'brief',label:'创作说明',kind:'text',required:true,maximumLength:40},\n {key:'image',label:'主图版本',kind:'image',required:false},\n {key:'brand',label:'品牌资料',kind:'brand-kit',required:false},\n {key:'references',label:'参考图列表',kind:'images',required:false,maximumItems:2},\n {key:'sources',label:'来源图片',kind:'images',required:false,bindToSourceVersions:true},\n {key:'products',label:'商品数据集',kind:'dataset',required:false,maximumItems:2},\n {key:'platform',label:'平台',kind:'select',required:true,options:['Amazon','淘宝/天猫']},\n {key:'region',label:'地区',kind:'select',required:true,dependentOptions:{inputKey:'platform',values:{Amazon:['US','EU'],'淘宝/天猫':['CN']}}},\n {key:'channels',label:'渠道组合',kind:'multi-select',required:false,maximumItems:1,options:['Web','手机']},\n {key:'quantity',label:'数量',kind:'number',required:false,defaultValue:2},\n {key:'captions',label:'启用字幕',kind:'boolean',required:false},\n];\nconst base=listSkillsForSurface('canvas');\nconst userSkill={...base[0],id:'ui-skill-personal',name:'本地个人技能',category:'custom',builtIn:false,ownerId:'ui-actor',inputs:fields};\nconst disabledSkill={...userSkill,id:'ui-skill-disabled',name:'已停用个人技能',enabled:false};\nconst state={values:{} as Record<string,unknown>,disposed:false};\nlet mounted=false;\nconst catalog=[...base,...CANVAS_WORKFLOW_SKILLS.filter(s=>!s.enabled).map(s=>({...s,enabled:true})),userSkill,disabledSkill];\nfunction FieldsHost({disabled}:{disabled:boolean}){\n const [values,setValues]=useState<Record<string,unknown>>({platform:'Amazon',region:'US',sources:['ui-source-version'],products:[{sku:'SKU-01',name:'桌面杯'}]});\n state.values=values;\n return <div aria-label=\"隔离字段宿主\" data-field-scroll className=\"h-dvh overflow-y-auto bg-card p-3 text-foreground\">\n <SkillInputFields fields={fields} values={values} disabled={disabled} onChange={(key,value)=>setValues(current=>({...current,[key]:value}))}/>\n </div>;\n}\nObject.assign(window,{skillMobile:{state,catalog,group:groupState,updateGroup(urls:string[]){if(!groupSetter)throw Error('RB_PUBLIC_GROUP_NOT_MOUNTED');groupSetter(urls);},mount(theme:'gold'|'mono',options:{surface:'fields'|'chat'|'group';disabled?:boolean;outer?:boolean}){\n if(mounted||state.disposed)throw Error('SKILL_MOBILE_FIXTURE_REMOUNT');mounted=true;\n document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');\n if(options.surface==='group'){\n  groupState.urls=['#2563eb','#dc2626','#16a34a'].map(color=>{const image=document.createElement('canvas');image.width=image.height=48;const context=image.getContext('2d');if(!context)throw Error('RB_DATA_PNG_CANVAS');context.fillStyle=color;context.fillRect(0,0,48,48);return image.toDataURL();});\n  root.render(<GroupHost theme={theme}/>);return;\n }\n const chat=<ChatPanel themeStyle={theme==='mono'?'monochrome':'gold'}/>;\n root.render(options.surface==='chat'?(options.outer?<div data-outer-scroll style={{height:'100dvh',overflowY:'auto'}}><div style={{height:120}}/><div style={{height:560}}>{chat}</div><div style={{height:400}}/></div>:chat):<FieldsHost disabled={Boolean(options.disabled)}/>);\n},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});\n";
let browser: Browser | undefined;
let bundle = '', css = '';
const live = new Set<Session>(), contexts = new Set<BrowserContext>();

beforeAll(async () => {
  if (typeof process.getBuiltinModule !== 'function') throw Error('SKILL_MOBILE_FIXTURE_NATIVE_LOADER');
  const require = process.getBuiltinModule('node:module').createRequire(import.meta.url);
  const { build } = require('esbuild') as typeof import('esbuild');
  const NativeRegExp = (require('node:vm') as typeof import('node:vm')).runInThisContext('RegExp') as RegExpConstructor;
  const result = await build({ write: false, outfile: 'skill-mobile-fixture.js', bundle: true, metafile: true, platform: 'browser', format: 'iife', target: 'es2022', absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'false', '__dirname': '"/"' }, inject: ['task5-next-client-process'],
    plugins: [{ name: 'next-official-browser-variants', setup(builder: import('esbuild').PluginBuild): void {
      const browserVariants = require('next/dist/build/browser-variant-modules') as { browserVariantModules: string[] };
      const variants = new Map(browserVariants.browserVariantModules.map(id => [require.resolve(`next/dist/${id}.js`), require.resolve(`next/dist/${id}.browser.js`)]));
      const frameworkFilter = /(?:client-boundary-params|instant-samples|instant-validation[\\/]impl|navigation-dynamic-rendering|server-async-storage|unstable-rethrow)(?:\.js)?$/;
      builder.onResolve({ filter: new NativeRegExp('^task5-next-client-process$') }, () => ({ path: 'task5-next-client-process', namespace: 'task5-framework-host' }));
      builder.onLoad({ filter: new NativeRegExp('.*'), namespace: 'task5-framework-host' }, () => ({ contents: "export { default as process } from 'next/dist/compiled/process';", loader: 'js', resolveDir: process.cwd() }));
      const utilImporters = new Set([require.resolve('ag-psd/dist/abr.js'), require.resolve('ag-psd/dist/additionalInfo.js')].map(file => path.resolve(file)));
      builder.onResolve({ filter: new NativeRegExp('^util$') }, args => args.importer && utilImporters.has(path.resolve(args.importer)) ? { path: require.resolve('next/dist/compiled/util') } : undefined);
      builder.onResolve({ filter: new NativeRegExp(frameworkFilter.source, frameworkFilter.flags) }, args => { if (!args.importer) return undefined; const actual = createRequire(args.importer).resolve(args.path), browserFile = variants.get(actual); return browserFile ? { path: browserFile } : undefined; });
    } }], stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'skill-mobile-mobile-entry.tsx' } });
  const scripts = result.outputFiles.filter(f => f.path.endsWith('.js')), styles = result.outputFiles.filter(f => f.path.endsWith('.css'));
  if (scripts.length !== 1 || styles.length > 1 || styles.some(f=>!f.text.trim())) throw Error('SKILL_MOBILE_FIXTURE_MEMORY_BUNDLE'); bundle = scripts[0].text;
  const files = Object.keys(result.metafile!.inputs).filter(file => /^src[\\/]/.test(file) && /\.[jt]sx?$/.test(file));
  const sources = await Promise.all(files.map(async file => ({ content: await readFile(path.resolve(file), 'utf8'), extension: path.extname(file).slice(1) }))); sources.push({ content: ENTRY, extension: 'tsx' });
  const compiler = await compile(await readFile('src/app/globals.css', 'utf8'), { base: process.cwd(), loadStylesheet: async (id: string, base: string) => {
    const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id === 'tw-animate-css' ? path.resolve('node_modules/tw-animate-css/dist/tw-animate.css') : require.resolve(id.startsWith('.') ? path.resolve(base, id) : id);
    return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
  } }); css = compiler.build(new Scanner({}).scanFiles(sources)) + '\n' + styles.map(file=>file.text).join('\n'); browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => {
  const failures: string[] = []; for (const s of live) { try { await dispose(s); } catch (error) { failures.push(String(error)); } }
  for (const context of contexts) { try { await context.close(); contexts.delete(context); } catch (error) { failures.push(String(error)); } }
  try { await browser?.close(); } finally { browser = undefined; } if (failures.length) throw Error(failures.join('\n'));
}, 15000);
async function bounded(name: string, operation: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('SKILL_MOBILE_FIXTURE_CLEANUP_TIMEOUT ' + name)), 2500); })]); } finally { if (timer) clearTimeout(timer); }
}
async function settle(page: Page): Promise<void> { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }

function requests(options: Options): string[] {
  return ['GET /', ...(options.surface === 'chat' ? ['GET /api/skills?surface=canvas','GET /api/models?type=chat','GET /api/models?type=vlm','GET /api/models?type=video','GET /api/models?type=image'] : []),
    ...(options.requiredProbe ? ['GET /required-probe'] : [])];
}
async function session(theme: Theme = 'gold', width = 390, height = 844, options: Options = {surface:'fields'}): Promise<Session> {
  if (!browser) throw Error('SKILL_MOBILE_FIXTURE_BROWSER_REQUIRED');
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce',...(options.touch?{hasTouch:true,isMobile:true}:{})});contexts.add(context);let value:Session|undefined;
  try {
    const page=await context.newPage();page.setDefaultTimeout(1500);
    const s:Session={context,page,options,errors:[],counts:new Map(),handlers:new Set(),pending:new Set(),completed:new Set(),failed:new Set(),refused:new Set(),waiters:new Set(),mounted:false};value=s;live.add(s);
    context.on('request',r=>s.pending.add(r));context.on('requestfinished',r=>{s.pending.delete(r);s.completed.add(r);for(const notify of s.waiters)notify();});context.on('requestfailed',r=>{s.pending.delete(r);s.failed.add(r);for(const notify of s.waiters)notify();});
    page.on('pageerror',e=>s.errors.push(String(e)));page.on('dialog',dialog=>{s.errors.push('SKILL_MOBILE_FIXTURE_UNEXPECTED_DIALOG');void dialog.dismiss().catch(e=>s.errors.push(String(e)));});
    await context.routeWebSocket('**/*',socket=>{s.errors.push('SKILL_MOBILE_FIXTURE_UNKNOWN_WS');socket.close({code:1008,reason:'Offline fixture'});});
    await context.route('**/*',async route=>{
      const operation=(async():Promise<void>=>{
        const r=route.request(),u=new URL(r.url()),headers=r.headers(),key=r.method()+' '+u.pathname+u.search;
        if(u.origin!==ORIGIN||u.username||u.password||headers.authorization||headers.cookie||headers['x-api-key']||headers['api-key']||r.postData()!==null)throw Error('SKILL_MOBILE_FIXTURE_HTTP_BOUNDARY');
        const count=(s.counts.get(key)??0)+1;s.counts.set(key,count);if(count!==1)throw Error('SKILL_MOBILE_FIXTURE_HTTP_COUNT '+key);
        if(key==='GET /'&&r.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="fixture-root" style="height:100dvh"></div></body></html>'});return;}
        if(options.surface==='chat'&&key==='GET /api/skills?surface=canvas'){const skills=await page.evaluate(()=>(window as unknown as FixtureWindow).skillMobile.catalog);if(options.longCategory){const personal=skills.find(skill=>skill.id==='ui-skill-personal');if(!personal)throw Error('SKILL_MOBILE_FIXTURE_PERSONAL_MISSING');skills.push({...personal,id:'ui-long-category',name:'长分类个人技能',category:'来自第三方扩展的超长分类名称需要完整显示而不能溢出屏幕'});}await route.fulfill({json:{skills}});return;}
        if(options.surface==='chat'&&/^GET \/api\/models\?type=(chat|vlm|video|image)$/.test(key)){await route.fulfill({json:{models:[],providers:[],taskModelCatalog:[]}});return;}
        throw Error('SKILL_MOBILE_FIXTURE_UNKNOWN_HTTP '+key);
      })().catch(async e=>{s.errors.push(String(e));s.refused.add(route.request());await route.abort('blockedbyclient');});
      s.handlers.add(operation);try{await operation;}finally{s.handlers.delete(operation);}
    });
    await page.goto(ORIGIN);await page.addScriptTag({content:bundle});await page.evaluate(({theme,options})=>(window as unknown as FixtureWindow).skillMobile.mount(theme,options),{theme,options});s.mounted=true;
    if(options.surface==='chat')await page.getByRole('button',{name:'Skills技能库',exact:true}).waitFor();else if(options.surface==='group')await page.locator('[data-node-id="rb-group-node"]').waitFor();else await page.getByRole('textbox',{name:'创作说明',exact:true}).waitFor();
    await expect.poll(()=>[...s.counts.keys()].sort(),{timeout:1500}).toEqual(requests({...options,requiredProbe:false}).sort());await nativeFinished(s);await settle(page);return s;
  }catch(error){try{if(value)await dispose(value);else{await context.close();contexts.delete(context);}}catch(cleanup){throw new AggregateError([error,cleanup],'SKILL_MOBILE_FIXTURE_BOOTSTRAP');}throw error;}
}
async function nativeFinished(s: Session): Promise<void> {
  let notify:(()=>void)|undefined;try{await bounded('native requests',()=>new Promise<void>(resolve=>{notify=()=>{if(!s.pending.size)resolve();};s.waiters.add(notify);notify();}));}finally{if(notify)s.waiters.delete(notify);}
}
async function dispose(s:Session,refusal?:'http'|'websocket',cleanupProbe?:()=>void):Promise<void>{
  const failures:unknown[]=[];
  try{if(s.mounted)await bounded('unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).skillMobile.unmount()));cleanupProbe?.();}catch(e){failures.push(e);}
  try{await bounded('routes',()=>Promise.all([...s.handlers]));await nativeFinished(s);await bounded('final routes',()=>Promise.all([...s.handlers]));}catch(e){failures.push(e);}
  const pending=s.pending.size!==0||s.handlers.size!==0;try{await s.context.close();contexts.delete(s.context);live.delete(s);}catch(e){failures.push(e);}
  const invalid=(code:string):never=>{if(failures.length)throw new AggregateError([Error(code),...failures],'SKILL_MOBILE_FIXTURE_VALIDATION_AND_CLEANUP');throw Error(code);};
  const expected=requests(s.options);if(refusal==='http')expected.push('GET /unexpected');
  if(JSON.stringify([...s.counts.keys()].sort())!==JSON.stringify(expected.sort())||[...s.counts.values()].some(n=>n!==1))invalid('SKILL_MOBILE_FIXTURE_REQUEST_VALIDATION');
  const failed=[...s.failed],refused=[...s.refused],key=(r:Request):string=>r.method()+' '+new URL(r.url()).pathname+new URL(r.url()).search;
  if(pending||s.pending.size||(refusal==='http'?failed.length!==1||refused.length!==1||failed[0]!==refused[0]||key(failed[0])!=='GET /unexpected':failed.length!==0||refused.length!==0)
    ||JSON.stringify([...s.completed].map(key).sort())!==JSON.stringify(expected.filter(k=>k!=='GET /unexpected').sort()))invalid('SKILL_MOBILE_FIXTURE_NATIVE_REQUEST_FAILURE');
  if(failures.length)throw Error('SKILL_MOBILE_FIXTURE_CLEANUP_FAILURE: '+failures.join('; '));
  if(refusal){const e=refusal==='http'?'Error: SKILL_MOBILE_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SKILL_MOBILE_FIXTURE_UNKNOWN_WS';if(s.errors.length!==1||s.errors[0]!==e)throw Error('SKILL_MOBILE_FIXTURE_UNEXPECTED_FAILURES');}
  if(s.errors.length)throw Error('SKILL_MOBILE_FIXTURE_INFRASTRUCTURE: '+s.errors.join('; '));
}
async function withSession(theme:Theme,width:number,height:number,options:Options,run:(s:Session)=>Promise<void>):Promise<void>{
 const s=await session(theme,width,height,options);let primary:unknown;try{await run(s);}catch(e){primary=e;}try{await dispose(s);}catch(cleanup){if(primary)throw new AggregateError([primary,cleanup],'SKILL_MOBILE_FIXTURE_TEST_AND_CLEANUP');throw cleanup;}if(primary)throw primary;
}
async function reveal(s:Session,scroller:Locator,control:Locator):Promise<void>{
 for(let i=0;i<12;i++){const clip=await scroller.boundingBox(),r=await control.boundingBox();if(!clip||!r)throw Error('SKILL_MOBILE_FIXTURE_SCROLL_RECT');
 if(r.y>=clip.y+1&&r.y+r.height<=clip.y+clip.height-1)return;
 expect(clip.height,'scroller fits target').toBeGreaterThanOrEqual(r.height+2);
 const delta=r.y<clip.y+1?r.y-clip.y-3:r.y+r.height-clip.y-clip.height+3;
 await s.page.mouse.move(clip.x+clip.width/2,clip.y+clip.height/2);await s.page.mouse.wheel(0,delta);await settle(s.page);
 if(i===11)console.log('SKILL_MOBILE_SCROLL_PROBE',JSON.stringify({label:await control.getAttribute('aria-label'),clip,target:r,scroller:await scroller.evaluate(e=>({tag:e.tagName,overflowY:getComputedStyle(e).overflowY,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}))}));
 }expect(false,'native scroll reaches action').toBe(true);
}
async function target(control:Locator):Promise<void>{
 const v=await control.evaluate(e=>{const r=e.getBoundingClientRect();let clear=r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
 for(let p=e.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),s=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(s.overflowX)&&(r.left<b.left+p.clientLeft-.5||r.right>b.left+p.clientLeft+p.clientWidth+.5))clear=false;if(/(auto|scroll|hidden|clip)/.test(s.overflowY)&&(r.top<b.top+p.clientTop-.5||r.bottom>b.top+p.clientTop+p.clientHeight+.5))clear=false;}
 const x=r.x+r.width/2,y=r.y+r.height/2;return{width:r.width,height:r.height,clear,hit:[[x,y],[r.left+8,y],[r.right-8,y],[x,r.top+8],[x,r.bottom-8]].every(([a,b])=>e.contains(document.elementFromPoint(a,b)))};
 });expect(v.width,'target width').toBeGreaterThanOrEqual(44);expect(v.height,'target height').toBeGreaterThanOrEqual(44);expect(v.clear,'whole target visible').toBe(true);expect(v.hit,'native hit').toBe(true);
}
function fieldScroll(s:Session):Locator{return s.page.locator('[data-field-scroll]');}
async function capture(s:Session,name:string):Promise<void>{const dir=path.resolve('output/playwright/skills-native-20261018',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,name+'.png');await s.page.screenshot({path:file});console.log('SKILL_MOBILE_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false}));}
async function values(s:Session):Promise<Record<string,unknown>>{return s.page.evaluate(()=>(window as unknown as FixtureWindow).skillMobile.state.values);}
// RB adds two separate group gates and a file-import flow. A passing functional
// centre-tap flow cannot replace the independent 44px target gate.
async function rbGroupState(s:Session):Promise<FixtureWindow['skillMobile']['group']>{
 return s.page.evaluate(()=>(window as unknown as FixtureWindow).skillMobile.group);
}
function rbGroupCard(s:Session):Locator{return s.page.locator('[data-node-id="rb-group-node"]');}
function rbPager(s:Session):Locator{return rbGroupCard(s).getByText(/^\d+\/\d+$/).locator('..');}
async function rbCentreTap(s:Session,control:Locator):Promise<void>{
 const point=await control.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{clear:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(x,y))};});
 expect(point.clear,'RB functional target visible').toBe(true);expect(point.hit,'RB functional centre unoccluded').toBe(true);
 await control.tap();await settle(s.page);
}
async function rbChooseFile(s:Session,payload:{name:string;mimeType:string;buffer:Buffer}):Promise<void>{
 const label=s.page.getByText('导入 CSV/JSON',{exact:true});await reveal(s,fieldScroll(s),label);await target(label);
 const [chooser]=await Promise.all([s.page.waitForEvent('filechooser'),label.tap()]);
 await chooser.setFiles(payload);
}
for(const theme of THEMES){
 it('RB group '+theme+' has touch-sized visible pagination controls',async()=>{
  await withSession(theme,390,844,{surface:'group',touch:true},async s=>{
   const controls=rbPager(s).getByRole('button');expect(await controls.count()).toBe(2);
   const geometry=await controls.evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{width:r.width,height:r.height,label:el.getAttribute('aria-label'),clear:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(x,y))};}));
   console.log('RB_GROUP_CONTROLS',JSON.stringify({theme,geometry,standaloneProductionCard:true,notWholeNodeEditorAcceptance:true}));
   await capture(s,'rb-'+theme+'-group-controls');
   for(const control of await controls.all())await target(control);
   expect(await controls.nth(0).getAttribute('aria-label'),'RB previous image accessible name').toBe('上一张图片');
   expect(await controls.nth(1).getAttribute('aria-label'),'RB next image accessible name').toBe('下一张图片');
   console.log('RB_GROUP_CONTROLS_COMPLETE',JSON.stringify({theme,touch44Accepted:true,notAndroid:true}));
  });
 },25000);
 it('RB group '+theme+' keeps valid results after same-instance tail shrink',async()=>{
  await withSession(theme,390,844,{surface:'group',touch:true},async s=>{
   const card=rbGroupCard(s),first=card.getByRole('img',{name:'图片 1',exact:true});await first.waitFor();
   const groupRoot=await first.locator('../..').elementHandle();if(!groupRoot)throw Error('RB_GROUP_ROOT_REQUIRED');
   const before=await rbGroupState(s);expect(before.urls.length).toBe(3);expect(before.mounts).toBe(1);
   await rbCentreTap(s,rbPager(s).getByRole('button').nth(1));expect(await rbPager(s).textContent()).toBe('2/3');
   await rbCentreTap(s,rbPager(s).getByRole('button').nth(1));expect(await rbPager(s).textContent()).toBe('3/3');
   expect(await card.getByRole('img',{name:'图片 3',exact:true}).getAttribute('src')).toBe(before.urls[2]);
   console.log('RB_GROUP_BEFORE_SHRINK',JSON.stringify({theme,page:await rbPager(s).textContent(),urls:before.urls,nodeId:before.nodeId,mounts:before.mounts,updates:before.updates,nativeTwoTaps:true,touchSizeAcceptedByThisCase:false}));
   await s.page.evaluate(urls=>(window as unknown as FixtureWindow).skillMobile.updateGroup(urls),before.urls.slice(0,2));await settle(s.page);
   const after=await rbGroupState(s),retained=await groupRoot.evaluate(el=>el.isConnected),page=await rbPager(s).textContent();
   console.log('RB_GROUP_AFTER_SHRINK',JSON.stringify({theme,page,urls:after.urls,nodeId:after.nodeId,mounts:after.mounts,updates:after.updates,rootRetained:retained,publicPropsOnly:true}));
   await capture(s,'rb-'+theme+'-group-after-shrink');
   expect(retained,'RB same component DOM root retained').toBe(true);expect(after.nodeId).toBe(before.nodeId);expect(after.mounts).toBe(1);expect(after.updates).toBe(1);expect(after.urls).toEqual(before.urls.slice(0,2));
   const parts=(page??'').match(/^(\d+)\/(\d+)$/);expect(parts,'RB pagination remains present').not.toBeNull();
   const selected=Number(parts![1]),total=Number(parts![2]);expect(total).toBe(2);expect(selected).toBeGreaterThanOrEqual(1);expect(selected,'RB page index stays in current result range').toBeLessThanOrEqual(total);
   const shown=card.getByRole('img',{name:'图片 '+selected,exact:true});await shown.waitFor();expect(await shown.getAttribute('src')).toBe(after.urls[selected-1]);expect(await card.getByText('等待图片组',{exact:true}).count()).toBe(0);
   await rbCentreTap(s,shown.locator('..'));expect((await rbGroupState(s)).previews).toEqual([after.urls[selected-1]]);
   console.log('RB_GROUP_SHRINK_COMPLETE',JSON.stringify({theme,rootRetained:true,validPage:true,imageFromCurrentSet:true,previewFromCurrentSet:true,publicPropsOnly:true,touchSizeAcceptedByThisCase:false,notWholeNodeEditorOrModalAcceptance:true}));
  });
 },25000);
 it('RB SKU '+theme+' imports files preserves errors and permits identical reselection',async()=>{
  await withSession(theme,390,844,{surface:'fields',touch:true},async s=>{
   const baseline=await values(s),products=s.page.getByLabel('商品数据集',{exact:true}),input=s.page.getByLabel('导入 商品数据集',{exact:true}),preview=s.page.locator('[aria-label="商品数据集预览"]');
   expect(await input.getAttribute('accept')).toBe('.csv,.json');
   const csvRows=[{sku:'CSV-A',name:'耳机, 黑色'},{sku:'CSV-B',name:'白杯'}],jsonRows=[{sku:'JSON-A',name:'黑杯'},{sku:'JSON-B',name:'白杯'}];
   const csv={name:'rb-sku.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFFsku,name\r\nCSV-A,"耳机, 黑色"\r\nCSV-B,白杯\r\n')};
   const json={name:'rb-sku.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(jsonRows))};
   const first=theme==='gold'?csv:json,firstRows=theme==='gold'?csvRows:jsonRows;
   await rbChooseFile(s,first);await expect.poll(async()=>(await values(s)).products,{timeout:1500}).toEqual(firstRows);
   expect(await products.inputValue()).toBe(JSON.stringify(firstRows,null,2));expect(await input.inputValue()).toBe('');
   const oldText=await products.inputValue(),oldPreview=await preview.textContent();
   const bad=theme==='gold'?{...json,buffer:Buffer.from('[invalid')}:{...csv,buffer:Buffer.from('sku,sku,name\nA,B,坏表头')};
   await rbChooseFile(s,bad);await s.page.getByRole('alert').filter({hasText:theme==='gold'?'JSON 文件格式无效':'CSV 表头不能重复'}).waitFor();
   expect((await values(s)).products,'RB rejected file preserves committed rows').toEqual(firstRows);expect(await products.inputValue()).toBe(oldText);expect(await preview.textContent()).toBe(oldPreview);expect(await input.inputValue()).toBe('');
   const corrected=theme==='gold'?json:csv,correctedRows=theme==='gold'?jsonRows:csvRows;
   await rbChooseFile(s,corrected);await expect.poll(async()=>(await values(s)).products,{timeout:1500}).toEqual(correctedRows);
   expect(await s.page.getByRole('alert').count()).toBe(0);expect(await products.inputValue()).toBe(JSON.stringify(correctedRows,null,2));expect(await input.inputValue()).toBe('');
   await reveal(s,fieldScroll(s),products);await target(products);await products.fill('[{"sku":"SCRATCH","name":"重选前临时值"}]');
   expect((await values(s)).products).toEqual([{sku:'SCRATCH',name:'重选前临时值'}]);
   await rbChooseFile(s,corrected);await expect.poll(async()=>(await values(s)).products,{timeout:1500}).toEqual(correctedRows);
   expect(await products.inputValue()).toBe(JSON.stringify(correctedRows,null,2));expect(await input.inputValue()).toBe('');expect(await s.page.getByRole('alert').count()).toBe(0);
   expect(await preview.getByRole('row').count()).toBe(3);expect(await preview.getByRole('cell').allTextContents()).toEqual(correctedRows.flatMap(row=>[row.sku,row.name]));
   const {products:_oldProducts,...otherBefore}=baseline,{products:_newProducts,...otherAfter}=await values(s);void _oldProducts;void _newProducts;expect(otherAfter).toEqual(otherBefore);
   await capture(s,'rb-'+theme+'-sku-import-complete');
   console.log('RB_SKU_IMPORT_COMPLETE',JSON.stringify({theme,firstName:first.name,rejectedName:bad.name,correctedName:corrected.name,identicalReselection:true,errorPreservedOriginalValuesAndPreview:true,errorCleared:true,otherFieldsUnchanged:true,inputReset:true,browserFileInjection:true,nativeTouchEntry:true,nativeWheelReveal:true,physicalAndroid:false,notSkuTaskExecutionAcceptance:true}));
  });
 },25000);
}


// RC separates the preview frame from the already-recorded pagination findings.
for(const theme of THEMES){
 it('RC preview '+theme+' keeps image touch frame usable through single empty and restored results',async()=>{
  await withSession(theme,390,844,{surface:'group',touch:true},async s=>{
   const card=rbGroupCard(s),image=card.getByRole('img',{name:'图片 1',exact:true}),frame=image.locator('..');
   await image.waitFor();
   const decoded=await image.evaluate(async element=>{
    const image=element as HTMLImageElement;let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([image.decode(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('RC_PREVIEW_DECODE_TIMEOUT')),1500);})]);}
    finally{if(timer)clearTimeout(timer);}
    if(!image.complete||image.naturalWidth!==48||image.naturalHeight!==48)throw Error('RC_PREVIEW_DECODE_SHAPE');
    return true;
   });
   const first=await rbGroupState(s),root=await image.locator('../..').elementHandle();if(!root)throw Error('RC_PREVIEW_ROOT_REQUIRED');
   const geometry=await frame.evaluate(el=>{const r=el.getBoundingClientRect(),img=el.querySelector('img'),i=img?.getBoundingClientRect();return{frame:{width:r.width,height:r.height},image:i?{width:i.width,height:i.height}:null,natural:img?{width:img.naturalWidth,height:img.naturalHeight}:null};});
   console.log('RC_PREVIEW_GEOMETRY',JSON.stringify({theme,...geometry,decodeSucceeded:decoded,firstUrl:first.urls[0],standaloneCard:true,notWholeNodeEditorAcceptance:true}));
   await capture(s,'rc-'+theme+'-preview-before-assertion');
   await target(frame);expect(geometry.image,'RC current image exists').not.toBeNull();
   expect(geometry.image!.width,'RC preview image displayed width').toBeGreaterThanOrEqual(44);expect(geometry.image!.height,'RC preview image displayed height').toBeGreaterThanOrEqual(44);
   await rbCentreTap(s,frame);expect((await rbGroupState(s)).previews).toEqual([first.urls[0]]);
   for(let i=0;i<2;i++){const next=rbPager(s).getByRole('button').nth(1);await target(next);await rbCentreTap(s,next);}expect(await rbPager(s).textContent()).toBe('3/3');
   await s.page.evaluate(url=>(window as unknown as FixtureWindow).skillMobile.updateGroup([url]),first.urls[1]);await settle(s.page);
   const single=card.getByRole('img',{name:'图片 1',exact:true});await single.waitFor();expect(await single.getAttribute('src')).toBe(first.urls[1]);expect(await card.getByText(/^\d+\/\d+$/).count()).toBe(0);
   await target(single.locator('..'));await rbCentreTap(s,single.locator('..'));expect((await rbGroupState(s)).previews).toEqual([first.urls[0],first.urls[1]]);
   await s.page.evaluate(()=>(window as unknown as FixtureWindow).skillMobile.updateGroup([]));await settle(s.page);
   const emptyImages=await card.getByRole('img').evaluateAll(nodes=>{
    const card=document.querySelector('[data-node-id="rb-group-node"]');if(!card)throw Error('RE_EMPTY_CARD_REQUIRED');
    return{urls:(window as unknown as FixtureWindow).skillMobile.group.urls,roleImages:nodes.map(node=>({tag:node.tagName.toLowerCase(),role:node.getAttribute('role'),label:node.getAttribute('aria-label'),alt:node.getAttribute('alt'),src:node.getAttribute('src'),connected:node.isConnected})),rasterCount:card.querySelectorAll('img').length};
   });
   console.log('RE_EMPTY_GROUP',JSON.stringify({theme,...emptyImages,publicPropsOnly:true,noDomMutation:true}));
   expect(emptyImages.urls,'RE empty public result set').toEqual([]);
   expect(emptyImages.roleImages.filter(node=>node.tag==='img'),'RE no accessible result photo remains').toEqual([]);
   expect(emptyImages.rasterCount,'RE empty results contain no raster image elements').toBe(0);
   expect(await card.getByText('等待图片组',{exact:true}).isVisible()).toBe(true);expect(await card.getByText(/^\d+\/\d+$/).count()).toBe(0);
   expect((await rbGroupState(s)).previews).toEqual([first.urls[0],first.urls[1]]);
   await s.page.evaluate(urls=>(window as unknown as FixtureWindow).skillMobile.updateGroup(urls),first.urls);await settle(s.page);
   expect(await rbPager(s).textContent(),'RC restored results do not revive an invalid tail index').toBe('1/3');
   const restored=card.getByRole('img',{name:'图片 1',exact:true});expect(await restored.getAttribute('src')).toBe(first.urls[0]);await target(restored.locator('..'));
   expect(await root.evaluate(el=>el.isConnected)).toBe(true);expect((await rbGroupState(s)).mounts).toBe(1);expect((await rbGroupState(s)).updates).toBe(3);
   expect((await rbGroupState(s)).previews,'RC restore emits no automatic preview callback').toEqual([first.urls[0],first.urls[1]]);
   await rbCentreTap(s,restored.locator('..'));expect((await rbGroupState(s)).previews).toEqual([first.urls[0],first.urls[1],first.urls[0]]);
   await capture(s,'rc-'+theme+'-preview-complete');
   console.log('RC_PREVIEW_COMPLETE',JSON.stringify({theme,frameTouch44:true,imageDisplayUsable:true,singleEmptyRestore:true,rootRetained:true,callbackCurrentOnly:true,nativeTap:true,physicalAndroid:false,notWholeNodeEditorOrModalAcceptance:true}));
  });
 },25000);
}
