// @vitest-environment node
// Real ChatPanel, shared SkillInputFields and shipped styles in Chromium. Synthetic HTTP only, never
// a saved browser profile, business account, real model or cloned UI.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { Scanner } from '@tailwindcss/oxide';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

type Theme = 'gold' | 'mono';
interface Options { surface: 'fields' | 'chat'; disabled?: boolean; requiredProbe?: boolean; longCategory?: boolean; outer?: boolean }
interface FixtureWindow extends Window { skillMobile: { mount(theme: Theme, options: Options): void; unmount(): void; state: { values: Record<string, unknown>; disposed: boolean }; catalog: SkillDefinition[] } }
interface Session { context: BrowserContext; page: Page; options: Options; errors: string[]; counts: Map<string, number>; handlers: Set<Promise<void>>; pending: Set<Request>; completed: Set<Request>; failed: Set<Request>; refused: Set<Request>; waiters: Set<() => void>; mounted: boolean }
const ORIGIN = 'https://skill-mobile-mobile.invalid';
const THEMES: readonly Theme[] = ['gold', 'mono'];
const ENTRY = "\nimport React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {ChatPanel} from '@/components/chat-panel';\nimport {SkillInputFields} from '@/components/skill-runtime/SkillInputFields';\nimport {listSkillsForSurface,CANVAS_WORKFLOW_SKILLS} from '@/lib/skill-runtime/catalog';\nimport type {SkillInputField} from '@/lib/skill-runtime/types';\nconst root=createRoot(document.getElementById('fixture-root')!);\nconst fields:readonly SkillInputField[]=[\n {key:'brief',label:'创作说明',kind:'text',required:true,maximumLength:40},\n {key:'image',label:'主图版本',kind:'image',required:false},\n {key:'brand',label:'品牌资料',kind:'brand-kit',required:false},\n {key:'references',label:'参考图列表',kind:'images',required:false,maximumItems:2},\n {key:'sources',label:'来源图片',kind:'images',required:false,bindToSourceVersions:true},\n {key:'products',label:'商品数据集',kind:'dataset',required:false,maximumItems:2},\n {key:'platform',label:'平台',kind:'select',required:true,options:['Amazon','淘宝/天猫']},\n {key:'region',label:'地区',kind:'select',required:true,dependentOptions:{inputKey:'platform',values:{Amazon:['US','EU'],'淘宝/天猫':['CN']}}},\n {key:'channels',label:'渠道组合',kind:'multi-select',required:false,maximumItems:1,options:['Web','手机']},\n {key:'quantity',label:'数量',kind:'number',required:false,defaultValue:2},\n {key:'captions',label:'启用字幕',kind:'boolean',required:false},\n];\nconst base=listSkillsForSurface('canvas');\nconst userSkill={...base[0],id:'ui-skill-personal',name:'本地个人技能',category:'custom',builtIn:false,ownerId:'ui-actor',inputs:fields};\nconst disabledSkill={...userSkill,id:'ui-skill-disabled',name:'已停用个人技能',enabled:false};\nconst state={values:{} as Record<string,unknown>,disposed:false};\nlet mounted=false;\nconst catalog=[...base,...CANVAS_WORKFLOW_SKILLS.filter(s=>!s.enabled).map(s=>({...s,enabled:true})),userSkill,disabledSkill];\nfunction FieldsHost({disabled}:{disabled:boolean}){\n const [values,setValues]=useState<Record<string,unknown>>({platform:'Amazon',region:'US',sources:['ui-source-version'],products:[{sku:'SKU-01',name:'桌面杯'}]});\n state.values=values;\n return <div aria-label=\"隔离字段宿主\" data-field-scroll className=\"h-dvh overflow-y-auto bg-card p-3 text-foreground\">\n <SkillInputFields fields={fields} values={values} disabled={disabled} onChange={(key,value)=>setValues(current=>({...current,[key]:value}))}/>\n </div>;\n}\nObject.assign(window,{skillMobile:{state,catalog,mount(theme:'gold'|'mono',options:{surface:'fields'|'chat';disabled?:boolean;outer?:boolean}){\n if(mounted||state.disposed)throw Error('SKILL_MOBILE_FIXTURE_REMOUNT');mounted=true;\n document.documentElement.classList.add(theme==='mono'?'theme-monochrome':'theme-gold');\n const chat=<ChatPanel themeStyle={theme==='mono'?'monochrome':'gold'}/>;\n root.render(options.surface==='chat'?(options.outer?<div data-outer-scroll style={{height:'100dvh',overflowY:'auto'}}><div style={{height:120}}/><div style={{height:560}}>{chat}</div><div style={{height:400}}/></div>:chat):<FieldsHost disabled={Boolean(options.disabled)}/>);\n},unmount(){if(!state.disposed){state.disposed=true;root.unmount();}}}});\n";
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
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce'});contexts.add(context);let value:Session|undefined;
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
    if(options.surface==='chat')await page.getByRole('button',{name:'Skills技能库',exact:true}).waitFor();else await page.getByRole('textbox',{name:'创作说明',exact:true}).waitFor();
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
async function openSkills(s:Session):Promise<Locator>{await s.page.getByRole('button',{name:'Skills技能库',exact:true}).click();await settle(s.page);return s.page.getByPlaceholder('搜索 Skills...').locator('../../..');}
async function capture(s:Session,name:string):Promise<void>{const dir=path.resolve('output/playwright/skills-native-20261018',String(process.pid));await mkdir(dir,{recursive:true});const file=path.join(dir,name+'.png');await s.page.screenshot({path:file});console.log('SKILL_MOBILE_NATIVE_CAPTURE',JSON.stringify({path:file,physicalTouch:false,coze:false}));}
async function values(s:Session):Promise<Record<string,unknown>>{return s.page.evaluate(()=>(window as unknown as FixtureWindow).skillMobile.state.values);}
describe('skill mobile red fields',()=>{
 it.each(THEMES.flatMap(theme=>[[320,640],[390,844],[640,320]].map(([width,height])=>({theme,width,height}))))('$theme $width x $height keeps fields and labels touch-sized',async({theme,width,height})=>{
  await withSession(theme,width,height,{surface:'fields'},async s=>{
   for(const name of ['创作说明','主图版本','品牌资料','参考图列表','商品数据集','平台','地区','数量']){const input=s.page.getByLabel(name,{exact:true});await reveal(s,fieldScroll(s),input);await target(input);expect(await input.evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),'input text size').toBeGreaterThanOrEqual(16);}
   for(const label of [s.page.locator('label').filter({hasText:/^启用字幕$/}),s.page.getByText('Web',{exact:true}).locator('..'),s.page.getByText('导入 CSV/JSON',{exact:true})]){await reveal(s,fieldScroll(s),label);await target(label);}
   await capture(s,theme+'-'+width+'x'+height+'-fields');
  });
 },25000);
});
describe('skill mobile red catalog',()=>{
 it.each(THEMES)('%s exposes real marketing and commerce categories without relabeling them custom',async theme=>{
  await withSession(theme,320,640,{surface:'chat'},async s=>{const panel=await openSkills(s);for(const [label,want] of [['营销',['preset-ad-ab-variants','preset-retargeting-creative','preset-omnichannel-campaign','preset-video-platform-thumbnails','preset-pinterest-pins']],['电商',['preset-batch-sku-assets','preset-platform-compliance-audit']]] as const){const button=panel.getByRole('button',{name:label,exact:true});expect(await button.count(),'real category is reachable').toBe(1);await button.click();await settle(s.page);const cards=panel.locator('[data-canvas-skill-id]');expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-canvas-skill-id')).sort())).toEqual([...want].sort());for(const card of await cards.all())expect(await card.getByText(label,{exact:true}).count(),'card uses its real category label').toBe(1);}});
 },25000);
});
describe('skill mobile red selection',()=>{
 it.each(THEMES)('%s reveals the active form after a real long-list click without stealing focus',async theme=>{
  await withSession(theme,390,844,{surface:'chat'},async s=>{const panel=await openSkills(s),card=panel.locator('[data-canvas-skill-id="preset-platform-compliance-audit"]');await reveal(s,panel,card);expect(await panel.evaluate(e=>e.scrollTop),'list actually scrolled').toBeGreaterThan(0);await card.click();await settle(s.page);const close=panel.locator('button[title="关闭 Skill"]');const position=await close.boundingBox(),box=await panel.boundingBox();if(!position||!box)throw Error('SKILL_MOBILE_FIXTURE_SCROLL_RECT');expect(position.y>=box.y&&position.y+position.height<=box.y+box.height,'selected form is brought into view').toBe(true);await target(close);const form=close.locator('../..'),first=form.locator('textarea,input:not([type="file"]),select').first();await target(first);expect(await s.page.evaluate(()=>['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName??'')),'does not force keyboard focus').toBe(false);});
 },25000);
});
describe('skill mobile red empty',()=>{
 it.each(THEMES)('%s shows a real no-match state when personal skills exist elsewhere',async theme=>{
  await withSession(theme,320,640,{surface:'chat'},async s=>{const panel=await openSkills(s);await panel.getByPlaceholder('搜索 Skills...').fill('没有这个技能XYZ');expect(await panel.locator('[data-canvas-skill-id]').count()).toBe(0);const empty=panel.getByText('没有匹配的技能',{exact:true});expect(await empty.count(),'filtered empty state is visible').toBe(1);expect(await empty.isVisible()).toBe(true);const r=await empty.boundingBox(),clip=await panel.boundingBox();if(!r||!clip)throw Error('SKILL_MOBILE_FIXTURE_EMPTY_RECT');expect(r.y>=clip.y&&r.y+r.height<=clip.y+clip.height,'empty state is inside visible scroll area').toBe(true);});
 },25000);
});
describe('skill mobile red controls',()=>{
 it.each(THEMES)('%s keeps the Skills entry and active form actions touch-sized',async theme=>{
  await withSession(theme,390,844,{surface:'chat'},async s=>{await target(s.page.getByRole('button',{name:'Skills技能库',exact:true}));const panel=await openSkills(s);for(const name of ['全部','图像','设计','品牌','自定义']){const button=panel.getByRole('button',{name,exact:true});await reveal(s,panel,button);await target(button);}await panel.getByPlaceholder('搜索 Skills...').fill('本地个人技能');const use=panel.locator('[data-canvas-skill-id="ui-skill-personal"] button[title="使用此 Skill"]');await reveal(s,panel,use);await target(use);await use.click();await settle(s.page);for(const button of [panel.locator('button[title="关闭 Skill"]'),panel.getByRole('button',{name:'估算积分',exact:true}),panel.getByRole('button',{name:'运行 Skill',exact:true})]){await reveal(s,panel,button);await target(button);}});
 },25000);
});
describe('skill mobile values',()=>{
 it.each(THEMES)('%s preserves real dependent fields, structured errors, selection limits and committed values',async theme=>{
  await withSession(theme,390,844,{surface:'fields'},async s=>{
   const brief=s.page.getByLabel('创作说明',{exact:true});await brief.fill('画一个移动端页面');
   const image=s.page.getByLabel('主图版本',{exact:true});await image.fill('ui-image-version');
   const references=s.page.getByLabel('参考图列表',{exact:true});await reveal(s,fieldScroll(s),references);await references.fill('a,b,c');await s.page.getByRole('alert').filter({hasText:'最多允许 2 项'}).waitFor();expect((await values(s)).references).toBeUndefined();await references.fill('a,b');expect((await values(s)).references).toEqual(['a','b']);
   const products=s.page.getByLabel('商品数据集',{exact:true});await reveal(s,fieldScroll(s),products);await products.fill('[invalid');await s.page.getByRole('alert').filter({hasText:'请输入有效的 JSON 数组'}).waitFor();expect((await values(s)).products).toEqual([{sku:'SKU-01',name:'桌面杯'}]);await products.fill('[{"sku":"SKU-02","name":"新杯"}]');expect((await values(s)).products).toEqual([{sku:'SKU-02',name:'新杯'}]);
   const platform=s.page.getByLabel('平台',{exact:true});await reveal(s,fieldScroll(s),platform);await platform.selectOption('淘宝/天猫');expect(await s.page.getByLabel('地区',{exact:true}).locator('option').allTextContents()).toEqual(['请选择','CN']);expect((await values(s)).region).toBeUndefined();
   const web=s.page.getByRole('checkbox',{name:'Web',exact:true});await reveal(s,fieldScroll(s),web.locator('..'));await web.check();expect(await s.page.getByRole('checkbox',{name:'手机',exact:true}).isDisabled()).toBe(true);expect((await values(s)).channels).toEqual(['Web']);
   const captions=s.page.getByRole('checkbox',{name:'启用字幕',exact:true});await reveal(s,fieldScroll(s),captions);await captions.check();const quantity=s.page.getByRole('spinbutton',{name:'数量',exact:true});await reveal(s,fieldScroll(s),quantity);await quantity.fill('7');expect((await values(s)).quantity).toBe(7);expect((await values(s)).captions).toBe(true);expect((await values(s)).brief).toBe('画一个移动端页面');await capture(s,theme+'-values');
  });
 },25000);
 it.each(THEMES)('%s retains disabled values and prevents label toggles',async theme=>{
  await withSession(theme,320,640,{surface:'fields',disabled:true},async s=>{const before=JSON.stringify(await values(s));for(const name of ['创作说明','主图版本','品牌资料','参考图列表','商品数据集','平台','地区','数量','启用字幕'])expect(await s.page.getByLabel(name,{exact:true}).isDisabled()).toBe(true);const label=s.page.locator('label').filter({hasText:/^启用字幕$/});await reveal(s,fieldScroll(s),label);await target(label);const r=await label.boundingBox();if(!r)throw Error('SKILL_MOBILE_FIXTURE_DISABLED_RECT');await s.page.mouse.click(r.x+r.width/2,r.y+r.height/2);expect(JSON.stringify(await values(s))).toBe(before);});
 },25000);
});
describe('skill mobile catalog behavior',()=>{
 it.each(THEMES)('%s retains disabled personal skills but never makes their use action available',async theme=>{
  await withSession(theme,390,844,{surface:'chat'},async s=>{const panel=await openSkills(s);await panel.getByPlaceholder('搜索 Skills...').fill('已停用个人技能');const card=panel.locator('[data-canvas-skill-id="ui-skill-disabled"]');expect(await card.count()).toBe(1);expect(await card.locator('button[title="使用此 Skill"]').isDisabled()).toBe(true);expect(await card.locator('button[title="启用"]').isDisabled()).toBe(false);expect(await card.locator('button[title="删除"]').isDisabled()).toBe(false);});
 },25000);
 it.each(THEMES)('%s preserves search and selection when rotating the catalog',async theme=>{
  await withSession(theme,390,844,{surface:'chat'},async s=>{let panel=await openSkills(s);const search=panel.getByPlaceholder('搜索 Skills...');await search.fill('本地个人技能');expect(await panel.locator('[data-canvas-skill-id]').count()).toBe(1);await s.page.setViewportSize({width:640,height:320});await settle(s.page);expect(await search.inputValue()).toBe('本地个人技能');const card=panel.locator('[data-canvas-skill-id="ui-skill-personal"]'),use=card.locator('button[title="使用此 Skill"]');await reveal(s,panel,use);await use.click();await settle(s.page);await s.page.setViewportSize({width:390,height:844});await settle(s.page);panel=s.page.getByPlaceholder('搜索 Skills...').locator('../../..');const close=panel.locator('button[title="关闭 Skill"]');await target(close);await close.click();expect(await close.count()).toBe(0);expect(await search.inputValue()).toBe('本地个人技能');});
 },25000);
 it.each(THEMES)('%s represents public optional categories only from the received definitions',async theme=>{
  await withSession(theme,390,844,{surface:'chat'},async s=>{const panel=await openSkills(s);for(const label of ['画布工具','视频创作']){const category=panel.getByRole('button',{name:label,exact:true});expect(await category.count()).toBe(1);await category.click();expect(await panel.locator('[data-canvas-skill-id]').count()).toBe(1);}await capture(s,theme+'-catalog');});
 },25000);
 it.each(THEMES)('%s keeps a desktop form usable without horizontal page overflow',async theme=>{
  await withSession(theme,1440,900,{surface:'fields'},async s=>{const platform=s.page.getByLabel('平台',{exact:true});await reveal(s,fieldScroll(s),platform);await target(platform);expect(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(s,theme+'-desktop-fields');});
 },25000);
});
async function textContrast(control: Locator, placeholder = false): Promise<number> {
  return control.evaluate((element, isPlaceholder) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw Error('SKILL_MOBILE_FIXTURE_CONTRAST_CANVAS');
    type Rgba = [number, number, number, number]; type Rgb = [number, number, number];
    const rgba = (value: string): Rgba => {
      if (!CSS.supports('color', value) || /^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value)) throw Error('SKILL_MOBILE_FIXTURE_CONTRAST_COLOR');
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const blend = (front: Rgba, back: Rgb): Rgb => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])) as Rgb;
    const luminance = (rgb: Rgb): number => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (ratio([255, 255, 255], [255, 255, 255]) !== 1 || Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) > 0.000001) throw Error('SKILL_MOBILE_FIXTURE_CONTRAST_CANARY');
    const layers: Rgba[] = []; let opaque = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backgroundImage !== 'none') throw Error('SKILL_MOBILE_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');
      const color = rgba(style.backgroundColor); layers.push(color); if (color[3] === 1) { opaque = true; break; }
    }
    if (!opaque) throw Error('SKILL_MOBILE_FIXTURE_CONTRAST_BACKDROP_REQUIRED');
    let backdrop: Rgb = [255, 255, 255]; for (const layer of layers.reverse()) backdrop = blend(layer, backdrop);
    const own = getComputedStyle(element); if (own.filter !== 'none' || own.mixBlendMode !== 'normal' || own.backgroundImage !== 'none') throw Error('SKILL_MOBILE_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
    const background = blend(rgba(own.backgroundColor), backdrop), ownOpacity = Number(own.opacity);
    const text = isPlaceholder ? getComputedStyle(element, '::placeholder') : own;
    const paint = rgba(text.color); if (isPlaceholder) paint[3] *= Number(text.opacity);
    return ratio(blend([...blend(paint, background), ownOpacity], backdrop), blend([...background, ownOpacity], backdrop));
  }, placeholder);
}

describe('skill mobile review long category',()=>{
 it.each(THEMES)('%s keeps a received long category readable and inside its scroll area',async theme=>{
  await withSession(theme,320,640,{surface:'chat',longCategory:true},async s=>{const panel=await openSkills(s),button=panel.getByRole('button',{name:'来自第三方扩展的超长分类名称需要完整显示而不能溢出屏幕',exact:true});await reveal(s,panel,button);const clip=await panel.boundingBox();if(!clip)throw Error('SKILL_MOBILE_FIXTURE_SCROLL_RECT');const fits=await button.evaluate((e,b)=>{const r=e.getBoundingClientRect();return r.left>=b.x&&r.right<=b.x+b.width&&e.scrollWidth<=e.clientWidth;},clip);expect(fits,'long category content fits target').toBe(true);await target(button);await button.click();expect(await panel.locator('[data-canvas-skill-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-canvas-skill-id')))).toEqual(['ui-long-category']);});
 },25000);
});
describe('skill mobile review parent',()=>{
 it.each(THEMES)('%s reveals the form without scrolling its public parent',async theme=>{
  await withSession(theme,390,844,{surface:'chat',outer:true},async s=>{const panel=await openSkills(s),outer=s.page.locator('[data-outer-scroll]'),card=panel.locator('[data-canvas-skill-id="preset-platform-compliance-audit"]');await reveal(s,panel,card);const before=await outer.evaluate(e=>e.scrollTop);await card.click();await settle(s.page);const after=await outer.evaluate(e=>e.scrollTop);console.log('SKILL_MOBILE_PARENT_SCROLL',JSON.stringify({theme,before,after}));expect(after,'selection keeps parent scroll').toBe(before);await target(panel.locator('button[title="关闭 Skill"]'));});
 },25000);
});
describe('skill mobile review contrast',()=>{
 it.each(THEMES)('%s keeps category controls and search placeholder readable',async theme=>{
  await withSession(theme,390,844,{surface:'chat'},async s=>{const panel=await openSkills(s),search=panel.getByPlaceholder('搜索 Skills...'),samples:Array<{text:string;ratio:number}>=[];
   samples.push({text:'search placeholder',ratio:await textContrast(search,true)});
   for(const control of await panel.getByRole('group',{name:'Skill 类别',exact:true}).getByRole('button').all())samples.push({text:await control.innerText(),ratio:await textContrast(control)});
   await panel.getByRole('button',{name:'营销',exact:true}).click();for(const card of await panel.locator('[data-canvas-skill-id]').all())samples.push({text:'card marketing label',ratio:await textContrast(card.getByText('营销',{exact:true}))});
   console.log('SKILL_MOBILE_CONTRAST',JSON.stringify({theme,samples}));expect(Math.min(...samples.map(s=>s.ratio)),'skill control text contrast').toBeGreaterThanOrEqual(4.5);
  });
 },25000);
});
describe('skill mobile contrast guard',()=>{
 it('measures transparent text as invisible rather than high contrast',async()=>{await withSession('gold',390,844,{surface:'chat'},async s=>{const panel=await openSkills(s),button=panel.getByRole('button',{name:'全部',exact:true});await button.evaluate(e=>{e.style.color='transparent';});await settle(s.page);expect(await textContrast(button)).toBe(1);});},25000);
 it('refuses an unsupported backdrop rather than assuming a flat color',async()=>{await withSession('gold',390,844,{surface:'chat'},async s=>{const panel=await openSkills(s),button=panel.getByRole('button',{name:'全部',exact:true});await button.evaluate(e=>{e.parentElement!.style.backgroundImage='linear-gradient(black,white)';});await settle(s.page);await expect(textContrast(button)).rejects.toThrow('SKILL_MOBILE_FIXTURE_CONTRAST_UNSUPPORTED_BACKDROP');});},25000);
});
describe('skill mobile fixture boundary',()=>{
 it.each(['fields','chat'] as const)('mounts the real %s graph with exact startup reads',async surface=>{await withSession('gold',390,844,{surface},async()=>{});},25000);
 it('keeps a missing promised read and cleanup fault together',async()=>{const s=await session('gold',390,844,{surface:'fields',requiredProbe:true});let failure:unknown;try{await dispose(s,undefined,()=>{throw Error('SKILL_MOBILE_FIXTURE_INJECTED_CLEANUP');});}catch(e){failure=e;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors.map(String)).toEqual(['Error: SKILL_MOBILE_FIXTURE_REQUEST_VALIDATION','Error: SKILL_MOBILE_FIXTURE_INJECTED_CLEANUP']);expect(live.has(s)).toBe(false);},25000);
 it.each(['http','websocket'] as const)('refuses unknown %s and observes its real termination',async transport=>{const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SKILL_MOBILE_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport)).rejects.toThrow(transport==='http'?'SKILL_MOBILE_FIXTURE_INFRASTRUCTURE: Error: SKILL_MOBILE_FIXTURE_UNKNOWN_HTTP GET /unexpected':'SKILL_MOBILE_FIXTURE_INFRASTRUCTURE: SKILL_MOBILE_FIXTURE_UNKNOWN_WS');}finally{if(live.has(s))await dispose(s);}},25000);
 it.each(['http','websocket'] as const)('does not absorb cleanup failure into expected %s refusal',async transport=>{const s=await session();try{if(transport==='http')await s.page.evaluate(async()=>{try{await fetch('/unexpected');}catch{}});else await s.page.evaluate(()=>new Promise<void>((resolve,reject)=>{const ws=new WebSocket('wss://unexpected.invalid'),timer=setTimeout(()=>reject(Error('SKILL_MOBILE_FIXTURE_WS_TIMEOUT')),1500);ws.onclose=()=>{clearTimeout(timer);resolve();};}));await expect(dispose(s,transport,()=>{throw Error('SKILL_MOBILE_FIXTURE_INJECTED_CLEANUP');})).rejects.toThrow('SKILL_MOBILE_FIXTURE_CLEANUP_FAILURE: Error: SKILL_MOBILE_FIXTURE_INJECTED_CLEANUP');expect(live.has(s)).toBe(false);expect(contexts.has(s.context)).toBe(false);}finally{if(live.has(s))await dispose(s);}},25000);
});
