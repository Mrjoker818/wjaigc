// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium, type Browser, type BrowserContext, type Page, type Request} from '@playwright/test';
import {afterAll, beforeAll, expect, it} from 'vitest';
import {acquireOwned, createOwnedOperations} from '../../../tests/helpers/native-owned-operations';

const ORIGIN='https://command-palette-focus-qq.invalid';
const SHOTS=path.resolve('output/playwright/command-palette-focus-qq',String(process.pid));
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CanvasCommandPalette} from '@/components/canvas/CanvasCommandPalette';
const root=createRoot(document.getElementById('fixture-root')!);
const state={actions:[] as string[],closes:0,errors:[] as string[]};
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){state.errors.push(error.message);}
 render(){return this.state.failed?null:this.props.children;}
}
Object.assign(window,{qqPalette:{state,
 mount(theme:string){document.documentElement.classList.toggle('dark',theme==='gold');
  document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
  root.render(<Boundary><CanvasCommandPalette theme={theme==='mono'?'mono':'dark'}
   commands={['first','second','third'].map((id,index)=>({id,label:['第一条命令','第二条命令','第三条命令'][index],action:()=>{state.actions.push(id);}}))}
   onClose={()=>{state.closes++;root.render(null);}} /></Boundary>);},
 unmount(){root.unmount();}
}});
`;
interface Snapshot {actions:string[];closes:number;errors:string[]}
interface FixtureWindow extends Window {qqPalette:{state:Snapshot;mount:(theme:string)=>void;unmount:()=>void}}
interface View {theme:'gold'|'mono';width:number;height:number}
interface Session {context:BrowserContext;page:Page;mounted:boolean;pending:Set<Request>;faults:string[];requests:string[];routes:Set<Promise<void>>}
const operations=createOwnedOperations(),contexts=new Set<BrowserContext>(),browsers=new Set<Browser>();
const contextCloses=new Map<BrowserContext,Promise<void>>(),browserCloses=new Map<Browser,Promise<void>>();
let browser:Browser|undefined,closing=false,bundle='',css='';
function closeContext(value:BrowserContext):Promise<void>{let p=contextCloses.get(value);if(!p){p=value.close();contextCloses.set(value,p);}return p;}
function closeBrowser(value:Browser):Promise<void>{let p=browserCloses.get(value);if(!p){p=value.close();browserCloses.set(value,p);}return p;}
beforeAll(async():Promise<void>=>{
 await operations.run('QQ-bundle-and-css',async()=>{
  if(fs.existsSync(SHOTS))throw Error('QQ_EXISTING_CAPTURE_DIRECTORY');fs.mkdirSync(SHOTS,{recursive:true});
  const require=createRequire(import.meta.url),file='src/components/canvas/CanvasCommandPalette.tsx';
  const compiler=await compile(fs.readFileSync('src/app/globals.css','utf8'),{base:process.cwd(),loadStylesheet:async(id:string,base:string)=>{
   const filename=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?path.resolve('node_modules/tw-animate-css/dist/tw-animate.css'):require.resolve(id.startsWith('.')?path.resolve(base,id):id);
   return{path:filename,base:path.dirname(filename),content:fs.readFileSync(filename,'utf8')};
  }});
  css=compiler.build(new Scanner({}).scanFiles([{content:fs.readFileSync(file,'utf8'),extension:'tsx'}]));
  bundle=(await build({write:false,bundle:true,platform:'browser',format:'iife',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{contents:ENTRY,resolveDir:process.cwd(),loader:'tsx',sourcefile:'qq-command-focus-entry.tsx'}})).outputFiles[0].text;
 },30000);
 browser=await acquireOwned(operations,'QQ-launch',async()=>{const value=await chromium.launch({headless:true,timeout:15000});browsers.add(value);value.once('disconnected',()=>browsers.delete(value));return value;},closeBrowser,()=>closing,15000);
},45000);
afterAll(async():Promise<void>=>{
 closing=true;const errors:unknown[]=[];
 for(const result of await Promise.allSettled([...contexts].map(c=>operations.run('QQ-context-final-close',()=>closeContext(c),5000))))if(result.status==='rejected')errors.push(result.reason);
 for(const result of await Promise.allSettled([...browsers].map(b=>operations.run('QQ-browser-final-close',()=>closeBrowser(b),5000))))if(result.status==='rejected')errors.push(result.reason);
 const pending=operations.pendingPromises();if(pending.length){try{await operations.run('QQ-final-drain',()=>Promise.allSettled(pending),5000);}catch(e){errors.push(e);}}
 const snapshot=operations.snapshot();console.log('QQ_OWNED_OPERATIONS '+JSON.stringify(snapshot));
 if(contexts.size||browsers.size||snapshot.pending.length||snapshot.lateErrors.length||snapshot.operations.some(o=>!o.settled||o.timedOut||o.rejected))errors.push(Error('QQ_RESOURCE_NOT_CLOSED'));
 if(errors.length)throw new AggregateError(errors,'QQ_FINAL_CLEANUP');
},20000);
async function drain(s:Session):Promise<void>{
 await operations.run('QQ-request-drain',async()=>{
  while(s.pending.size||s.routes.size)await new Promise<void>(resolve=>setTimeout(resolve,10));
 },1500);
}
async function open(view:View):Promise<Session>{
 if(!browser||closing)throw Error('QQ_NO_BROWSER');let ended=false;
 const context=await acquireOwned(operations,'QQ-context',async()=>{const c=await browser!.newContext({viewport:{width:view.width,height:view.height},hasTouch:true,isMobile:true,serviceWorkers:'block',reducedMotion:'reduce'});contexts.add(c);c.once('close',()=>contexts.delete(c));return c;},closeContext,()=>ended||closing,5000).catch(e=>{ended=true;throw e;});
 let page:Page;try{page=await acquireOwned(operations,'QQ-page',()=>context.newPage(),p=>p.close(),()=>ended||closing,5000);}catch(e){ended=true;await operations.run('QQ-bootstrap-context-close',()=>closeContext(context),5000);throw e;}
 const s:Session={context,page,mounted:false,pending:new Set(),faults:[],requests:[],routes:new Set()};page.setDefaultTimeout(1500);
 page.on('pageerror',e=>s.faults.push('PAGE:'+e.message));page.on('console',m=>{if(m.type()==='error')s.faults.push('CONSOLE:'+m.text());});
 page.on('request',q=>{s.pending.add(q);s.requests.push(q.method()+' '+q.url());});page.on('requestfinished',q=>s.pending.delete(q));page.on('requestfailed',q=>{s.pending.delete(q);s.faults.push('REQUEST_FAILED:'+q.url());});
 try{
  await context.routeWebSocket('**/*',socket=>{s.faults.push('UNEXPECTED_WS');socket.close({code:1008,reason:'offline-only'});});
  await context.route('**/*',async route=>{
   const task=(async():Promise<void>=>{const q=route.request();if(q.url()!==ORIGIN+'/'||q.method()!=='GET'||q.resourceType()!=='document'){s.faults.push('UNEXPECTED_HTTP:'+q.url());await route.abort('blockedbyclient');return;}
    await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'</style></head><body><div id="fixture-root"></div></body></html>'});})();
   s.routes.add(task);try{await task;}finally{s.routes.delete(task);}
  });
  await page.goto(ORIGIN+'/');await page.addScriptTag({content:bundle});s.mounted=true;await page.evaluate(theme=>(window as unknown as FixtureWindow).qqPalette.mount(theme),view.theme);
  await page.getByRole('dialog',{name:'画布命令面板'}).waitFor();await drain(s);return s;
 }catch(e){try{await dispose(s);}catch(c){throw new AggregateError([e,c],'QQ_BOOTSTRAP_AND_CLEANUP');}throw e;}
}
async function dispose(s:Session):Promise<void>{
 const errors:unknown[]=[];
 try{if(s.mounted){await operations.run('QQ-unmount',()=>s.page.evaluate(()=>(window as unknown as FixtureWindow).qqPalette.unmount()),3000);s.mounted=false;}
  await drain(s);expect(s.requests).toEqual(['GET '+ORIGIN+'/']);expect(s.faults).toEqual([]);expect(await s.page.evaluate(()=>(window as unknown as FixtureWindow).qqPalette.state.errors)).toEqual([]);
 }catch(e){errors.push(e);}finally{try{await operations.run('QQ-context-close',()=>closeContext(s.context),5000);}catch(e){errors.push(e);}}
 if(errors.length)throw new AggregateError(errors,'QQ_SESSION_CLEANUP');
 console.log('QQ_CLEANUP '+JSON.stringify({requests:s.requests,pending:s.pending.size,routes:s.routes.size,faults:s.faults,contextClosed:!contexts.has(s.context)}));
}
const views:View[]=(['gold','mono'] as const).flatMap(theme=>[{theme,width:390,height:844},{theme,width:640,height:320}]);
for(const view of views)it(`QQ ${view.theme} ${view.width}x${view.height} Tab focus activates its command exactly once with Enter and Space`,async():Promise<void>=>{
 const s=await open(view);let primary:unknown,failed=false;
 try{
  const {page}=s,search=page.getByRole('searchbox',{name:'搜索画布命令'}),first=page.getByRole('button',{name:'第一条命令',exact:true}),second=page.getByRole('button',{name:'第二条命令',exact:true});
  expect(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport?.scale}))).toEqual({width:view.width,height:view.height,scale:1});
  await expect.poll(()=>search.evaluate(el=>document.activeElement===el)).toBe(true);
  await page.keyboard.press('Tab');expect(await page.getByRole('button',{name:'关闭命令面板'}).evaluate(el=>document.activeElement===el)).toBe(true);
  await page.keyboard.press('Tab');expect(await first.evaluate(el=>document.activeElement===el)).toBe(true);
  await page.keyboard.press('Tab');expect(await second.evaluate(el=>document.activeElement===el)).toBe(true);
  const before=await second.evaluate(el=>{const b=el.getBoundingClientRect();return{focused:document.activeElement===el,selected:el.getAttribute('aria-current'),left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};});
  const screenshot=path.join(SHOTS,`${view.theme}-${view.width}x${view.height}-second-focused.png`);await page.screenshot({path:screenshot});
  await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'画布命令面板'}).waitFor({state:'detached'});
  const afterEnter=await page.evaluate(()=>(window as unknown as FixtureWindow).qqPalette.state);
  console.log('QQ_ENTER_OBSERVATION '+JSON.stringify({view,before,afterEnter,screenshot,physicalAndroid:false}));
  expect(afterEnter.actions,'native Enter activates the focused second command').toEqual(['second']);expect(afterEnter.closes).toBe(1);
  expect(before.selected).toBe('true');expect(before.width).toBeGreaterThanOrEqual(44);expect(before.height).toBeGreaterThanOrEqual(44);expect(before.left).toBeGreaterThanOrEqual(0);expect(before.right).toBeLessThanOrEqual(view.width);expect(before.top).toBeGreaterThanOrEqual(0);expect(before.bottom).toBeLessThanOrEqual(view.height);
  await page.evaluate(theme=>(window as unknown as FixtureWindow).qqPalette.mount(theme),view.theme);await search.waitFor();await expect.poll(()=>search.evaluate(el=>document.activeElement===el)).toBe(true);
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');expect(await second.evaluate(el=>document.activeElement===el)).toBe(true);
  await first.hover();expect(await second.evaluate(el=>document.activeElement===el)).toBe(true);await page.keyboard.press('Enter');await search.waitFor({state:'detached'});
  expect(await page.evaluate(()=>(window as unknown as FixtureWindow).qqPalette.state.actions)).toEqual(['second','second']);
  await page.evaluate(theme=>(window as unknown as FixtureWindow).qqPalette.mount(theme),view.theme);await search.waitFor();await expect.poll(()=>search.evaluate(el=>document.activeElement===el)).toBe(true);
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Space');await search.waitFor({state:'detached'});
  expect(await page.evaluate(()=>(window as unknown as FixtureWindow).qqPalette.state)).toEqual({actions:['second','second','second'],closes:3,errors:[]});
  console.log('QQ_FOCUS_BODY '+JSON.stringify({view,nativeTab:true,nativeEnter:true,nativeSpace:true,hoverCannotRedirectFocus:true,actions:['second','second','second'],closes:3,notWholeCanvas:true,notPhysicalAndroid:true}));
 }catch(e){failed=true;primary=e;}
 try{await dispose(s);}catch(cleanup){throw new AggregateError(failed?[primary,cleanup]:[cleanup],'QQ_BODY_AND_CLEANUP');}if(failed)throw primary;
},25000);
