// @vitest-environment node
// Real populated VideoGenerationPanel; only offline GETs and local draft actions.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {build} from 'esbuild';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type Request,type Route} from '@playwright/test';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createOwnedOperations,acquireOwned} from '../../../tests/helpers/native-owned-operations';
import type {TaskModelDescriptor} from '@/lib/task-core/model-capability-contract';

const ORIGIN='https://video-frames-mobile.invalid';
const SHOTS=path.resolve('output/playwright/video-history-touch-mobile-native',String(process.pid));
const FIRST='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4st78PwgzwBgAYgQK5f/y4U4AAAAASUVORK5CYII=';
const LAST='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQTX79H4QZYAwAUe4JyWDrWCIAAAAASUVORK5CYII=';
const HISTORY=JSON.stringify([{id:'ou-history-1',timestamp:1,prompt:'离线四条历史1',model:'or-provider::or-video',mode:'image2video-first',aspectRatio:'16:9',duration:5,thumbnailUrl:FIRST,firstFrameUrl:FIRST,lastFrameUrl:LAST},{id:'ou-history-2',timestamp:2,prompt:'离线四条历史2',model:'or-provider::or-video',mode:'image2video-first',aspectRatio:'16:9',duration:5,thumbnailUrl:LAST,firstFrameUrl:LAST,lastFrameUrl:FIRST},{id:'ou-history-3',timestamp:3,prompt:'离线四条历史3',model:'or-provider::or-video',mode:'image2video-first',aspectRatio:'16:9',duration:5,thumbnailUrl:FIRST,firstFrameUrl:FIRST,lastFrameUrl:LAST},{id:'ou-history-4',timestamp:4,prompt:'离线四条历史4',model:'or-provider::or-video',mode:'image2video-first',aspectRatio:'16:9',duration:5,thumbnailUrl:LAST,firstFrameUrl:LAST,lastFrameUrl:FIRST}]);
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import VideoPanel from '@/components/video-generation-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={mounted:false,closes:0,generations:0,errors:[] as string[]};
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:Error){state.errors.push(e.message);}
 render(){return this.state.failed?null:this.props.children;}
}
Object.assign(window,{ouFixture:{
 mount(theme:string,first:string,history:string){if(state.mounted)throw Error('OR_REMOUNT');state.mounted=true;
  document.documentElement.classList.toggle('dark',theme==='gold');document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
  localStorage.setItem('wujie_video_gen_history',history);
  root.render(<Boundary><VideoPanel floating selectedImageUrl={first} themeStyle={theme==='mono'?'monochrome':'gold'}
   onVideoGenerate={()=>{state.generations++;throw Error('OR_GENERATION_FORBIDDEN');}}
   onClose={()=>{state.closes++;root.render(null);}} onError={e=>state.errors.push(e)}/></Boundary>);},
 unmount(){root.unmount();},snapshot(){return {...state,history:localStorage.getItem('wujie_video_gen_history')};}
}});
`;
interface Snapshot{mounted:boolean;closes:number;generations:number;errors:string[];history:string|null}
declare global{interface Window{ouFixture:{mount:(theme:string,first:string,history:string)=>void;unmount:()=>void;snapshot:()=>Snapshot}}}
interface Session{context:BrowserContext;page:Page;mounted:boolean;handlers:Set<Promise<void>>;pending:Set<Request>;faults:string[];requests:string[]}
interface ActionShape{id:string;name:string|null;opacity:number;width:number;height:number;visible:boolean;hits:boolean[]}
const descriptor:TaskModelDescriptor={providerId:'or-provider',modelId:'or-video',kind:'video',sourceType:'video',protocol:'openai',executionMode:'async',allowedRatios:['16:9','1:1'],allowedSizes:['720p'],qualityOptions:['std','pro'],maxOutputs:4,supportsReferenceImages:true,maxReferenceImages:4,supportsMask:false,allowedDurationsSeconds:[5,10],maxDurationSeconds:10,supportedOperations:['text-to-video','image-to-video','first-last-frame'],outputKinds:['video'],capabilitySources:{}};
let browser:Browser|undefined,bundle='',css='',closing=false;
const live=new Set<Session>(),contexts=new Set<BrowserContext>(),browsers=new Set<Browser>(),contextClosing=new Map<BrowserContext,Promise<void>>(),browserClosing=new Map<Browser,Promise<void>>(),operations=createOwnedOperations();
function closeContext(c:BrowserContext):Promise<void>{let p=contextClosing.get(c);if(!p){p=c.close();contextClosing.set(c,p);}return p;}
function closeBrowser(b:Browser):Promise<void>{let p=browserClosing.get(b);if(!p){p=b.close();browserClosing.set(b,p);}return p;}
async function bounded<T>(label:string,operation:()=>Promise<T>,ms=2500):Promise<T>{return operations.run('OR-'+label,operation,ms);}
beforeAll(async():Promise<void>=>{
 const started=performance.now();await bounded('compile',async()=>{
  if(fs.existsSync(SHOTS))throw Error('OR_OLD_SHOTS');fs.mkdirSync(SHOTS,{recursive:true});
  const require=createRequire(import.meta.url),output=await build({write:false,metafile:true,bundle:true,platform:'browser',format:'iife',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{contents:ENTRY,resolveDir:process.cwd(),loader:'tsx',sourcefile:'or-video-frames-entry.tsx'}});
  if(output.outputFiles.length!==1||!output.metafile)throw Error('OR_BUNDLE_REQUIRED');bundle=output.outputFiles[0].text;
  const files=Object.keys(output.metafile.inputs).filter(f=>/^src[\\/]/.test(f)&&/\.[jt]sx?$/.test(f));
  const compiler=await compile(fs.readFileSync('src/app/globals.css','utf8'),{base:process.cwd(),loadStylesheet:async(id:string,base:string)=>{
   const file=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?path.resolve('node_modules/tw-animate-css/dist/tw-animate.css'):require.resolve(id.startsWith('.')?path.resolve(base,id):id);
   return {path:file,base:path.dirname(file),content:fs.readFileSync(file,'utf8')};}});
  css=compiler.build(new Scanner({}).scanFiles(files.map(f=>({content:fs.readFileSync(f,'utf8'),extension:path.extname(f).slice(1)}))));
 },30000);
 if(closing||performance.now()-started>15000)throw Error('OR_SETUP_BUDGET');
 browser=await acquireOwned(operations,'OR-launch',async()=>{const b=await chromium.launch({headless:true,timeout:15000});browsers.add(b);b.once('disconnected',()=>browsers.delete(b));return b;},closeBrowser,()=>closing,15000);
},30000);
afterAll(async():Promise<void>=>{
 closing=true;const errors:unknown[]=[];
 for(const r of await Promise.allSettled([...live].map(dispose)))if(r.status==='rejected')errors.push(r.reason);
 for(const r of await Promise.allSettled([...contexts].map(c=>bounded('remaining-context',()=>closeContext(c),5000))))if(r.status==='rejected')errors.push(r.reason);
 for(const r of await Promise.allSettled([...browsers].map(b=>bounded('browser-close',()=>closeBrowser(b),5000))))if(r.status==='rejected')errors.push(r.reason);
 const pending=operations.pendingPromises();if(pending.length)try{await bounded('actual-drain',()=>Promise.allSettled(pending));}catch(e){errors.push(e);}
 browser=undefined;const ops=operations.snapshot();console.log('ND_OWNED_OPERATIONS '+JSON.stringify(ops));
 if(contexts.size||browsers.size||ops.pending.length||ops.lateErrors.length||ops.operations.some(o=>!o.settled||o.timedOut||o.rejected))errors.push(Error('OR_RESOURCES_NOT_CLOSED'));
 if(errors.length)throw new AggregateError(errors,'OR_FINAL_CLEANUP');
},20000);
async function routeRequest(s:Session,route:Route):Promise<void>{
 const q=route.request(),u=new URL(q.url()),h=q.headers(),key=u.pathname+u.search;
 if(u.origin!==ORIGIN||u.username||u.password||u.hash||q.method()!=='GET'||q.postData()!==null||h.authorization||h.cookie||h['x-api-key']||h['api-key']||h['idempotency-key'])throw Error('OR_HTTP_BOUNDARY');
 s.requests.push(key);if(s.requests.filter(k=>k===key).length!==1)throw Error('OR_REPEATED_REQUEST');
 if(key==='/'&&q.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'</style></head><body style="margin:0"><div id="fixture-root"></div></body></html>'});return;}
 if(key==='/api/models?type=video'){await route.fulfill({json:{success:true,capabilityCatalogVersion:1,providers:[{id:'or-provider',name:'离线视频供应商'}],models:[{id:'or-video',name:'离线视频模型',displayName:'离线视频模型',type:'video',providerId:'or-provider',isDefault:true,isEnabled:true}],taskModelCatalog:[descriptor]}});return;}
 throw Error('OR_UNKNOWN_REQUEST '+key);
}
async function drain(s:Session):Promise<void>{const end=Date.now()+1500;while((s.handlers.size||s.pending.size)&&Date.now()<end)await new Promise<void>(resolve=>setTimeout(resolve,10));if(s.handlers.size||s.pending.size)throw Error('OR_NETWORK_NOT_DRAINED');}
async function open(theme:string,width:number,height:number):Promise<Session>{
 if(!browser||closing)throw Error('OR_NO_BROWSER');const owner={ended:false};
 const context=await acquireOwned(operations,'OR-context',async()=>{const c=await browser!.newContext({serviceWorkers:'block',viewport:{width,height},hasTouch:true,isMobile:true});contexts.add(c);c.once('close',()=>contexts.delete(c));return c;},closeContext,()=>closing||owner.ended).catch(e=>{owner.ended=true;throw e;});
 let page:Page;try{page=await acquireOwned(operations,'OR-page',()=>context.newPage(),p=>p.close(),()=>closing||owner.ended);}catch(e){owner.ended=true;await bounded('bootstrap-close',()=>closeContext(context),5000);throw e;}
 page.setDefaultTimeout(1500);const s:Session={context,page,mounted:false,handlers:new Set(),pending:new Set(),faults:[],requests:[]};live.add(s);
 page.on('pageerror',e=>s.faults.push('PAGE:'+e.message));page.on('console',m=>{if(m.type()==='error')s.faults.push('CONSOLE:'+m.text());});
 page.on('dialog',d=>{s.faults.push('DIALOG');void d.dismiss();});page.on('request',q=>s.pending.add(q));page.on('requestfinished',q=>s.pending.delete(q));page.on('requestfailed',q=>{s.pending.delete(q);s.faults.push('REQUEST_FAILED:'+q.url());});page.on('response',r=>{if(r.status()>=400)s.faults.push('HTTP_STATUS:'+r.status());});
 try{
  await context.routeWebSocket('**/*',socket=>{s.faults.push('WS_FORBIDDEN');socket.close({code:1008,reason:'offline-only'});});
  await context.route('**/*',async route=>{const task=routeRequest(s,route);s.handlers.add(task);try{await task;}catch(e){s.faults.push(String(e));try{await route.abort('blockedbyclient');}catch(a){s.faults.push(String(a));}}finally{s.handlers.delete(task);}});
  await page.goto(ORIGIN+'/');await page.addScriptTag({content:bundle});s.mounted=true;await page.evaluate(({theme,first,history})=>window.ouFixture.mount(theme,first,history),{theme,first:FIRST,history:HISTORY});
  await expect.poll(()=>page.locator('select').filter({has:page.locator('option[value="or-provider::or-video"]')}).inputValue(),{timeout:1500}).toBe('or-provider::or-video');await drain(s);return s;
 }catch(e){try{await dispose(s);}catch(c){throw new AggregateError([e,c],'OR_BOOTSTRAP_AND_CLEANUP');}throw e;}
}
async function dispose(s:Session):Promise<void>{
 const errors:unknown[]=[];try{if(s.mounted&&!s.page.isClosed()){await bounded('unmount',()=>s.page.evaluate(()=>window.ouFixture.unmount()),3000);s.mounted=false;}await bounded('routes',()=>Promise.all([...s.handlers]),3000);await drain(s);
  const state=await s.page.evaluate(()=>window.ouFixture.snapshot());if(state.errors.length||state.generations)errors.push(Error('OR_RUNTIME_OR_GENERATION'));if(s.requests.length!==2||!s.requests.includes('/')||!s.requests.includes('/api/models?type=video'))errors.push(Error('OR_REQUEST_SET'));
 }catch(e){errors.push(e);}finally{try{await bounded('context-close',()=>closeContext(s.context),5000);}catch(e){errors.push(e);}live.delete(s);}
 if(errors.length||s.faults.length)throw new AggregateError([...errors,...s.faults.map(e=>Error(e))],'OR_INFRASTRUCTURE');
}
async function withSession(theme:string,width:number,height:number,body:(s:Session)=>Promise<void>):Promise<void>{const s=await open(theme,width,height);let failed=false,cause:unknown;try{await body(s);}catch(e){failed=true;cause=e;}try{await dispose(s);}catch(e){throw new AggregateError(failed?[cause,e]:[e],'OR_BODY_AND_CLEANUP');}if(failed)throw cause;}
async function shape(control:Locator,id:string):Promise<ActionShape>{
 await control.scrollIntoViewIfNeeded();return control.evaluate((el,id)=>{const r=el.getBoundingClientRect();let left=0,right=innerWidth,top=0,bottom=innerHeight,opacity=1;
  for(let n:Element|null=el;n;n=n.parentElement){const c=getComputedStyle(n);opacity*=Number(c.opacity);if(n!==el){const b=n.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(c.overflowX)){left=Math.max(left,b.left+n.clientLeft);right=Math.min(right,b.left+n.clientLeft+n.clientWidth);}if(/hidden|clip|scroll|auto/.test(c.overflowY)){top=Math.max(top,b.top+n.clientTop);bottom=Math.min(bottom,b.top+n.clientTop+n.clientHeight);}}}
  const hits=[r.left+r.width*.25,(r.left+r.right)/2,r.left+r.width*.75].flatMap(x=>[r.top+r.height*.25,(r.top+r.bottom)/2,r.top+r.height*.75].map(y=>{const hit=document.elementFromPoint(x,y);return Boolean(hit&&(hit===el||el.contains(hit)));}));
  return{id,name:el.getAttribute('aria-label')||el.getAttribute('title'),opacity,width:r.width,height:r.height,visible:r.width>0&&r.height>0&&r.left>=left-1&&r.right<=right+1&&r.top>=top-1&&r.bottom<=bottom+1&&hits.every(Boolean),hits};
 },id);
}
async function nativeTap(control:Locator):Promise<void>{const p=await shape(control,'input');expect(p.visible&&p.opacity>=.99,'OR_VISIBLE_NATIVE_INPUT').toBe(true);await control.tap();}
for(const theme of ['gold','mono'] as const)it('OU '+theme+' 320x640 four populated history tiles remain separate and select exact fourth draft',async():Promise<void>=>{
 await withSession(theme,320,640,async s=>{
  const baseline=await s.page.evaluate(()=>window.ouFixture.snapshot()),device=await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,hover:matchMedia('(hover:hover)').matches}));
  expect(device).toMatchObject({width:320,height:640,coarse:true,hover:false});expect(device.touch).toBeGreaterThan(0);
  await nativeTap(s.page.getByRole('button',{name:'图生视频',exact:true}));await nativeTap(s.page.getByRole('button',{name:'生成历史 (4)',exact:true}));
  const tiles=s.page.locator('[data-floating-panel="video"] button').filter({has:s.page.locator('img[alt=""]')});expect(await tiles.count()).toBe(4);
  const grid=tiles.first().locator('..');await grid.scrollIntoViewIfNeeded();
  const layout=await grid.evaluate(element=>{
   const grid=element as HTMLElement,g=grid.getBoundingClientRect(),css=getComputedStyle(grid),buttons=Array.from(grid.children).filter((e):e is HTMLButtonElement=>e instanceof HTMLButtonElement);
   const rect=(r:DOMRect):{left:number;right:number;top:number;bottom:number;width:number;height:number}=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
   let left=0,right=innerWidth,top=0,bottom=innerHeight;const ancestors:Array<{tag:string;rect:ReturnType<typeof rect>;clientWidth:number;scrollWidth:number;scrollLeft:number;overflowX:string;overflowY:string}>=[];
   for(let p=grid.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),r=p.getBoundingClientRect();ancestors.push({tag:p.tagName,rect:rect(r),clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,scrollLeft:p.scrollLeft,overflowX:c.overflowX,overflowY:c.overflowY});if(/hidden|clip|scroll|auto/.test(c.overflowX)){left=Math.max(left,r.left+p.clientLeft);right=Math.min(right,r.left+p.clientLeft+p.clientWidth);}if(/hidden|clip|scroll|auto/.test(c.overflowY)){top=Math.max(top,r.top+p.clientTop);bottom=Math.min(bottom,r.top+p.clientTop+p.clientHeight);}}
   const rows=buttons.map((button,index)=>{const r=button.getBoundingClientRect(),c=getComputedStyle(button);let opacity=1;for(let p:Element|null=button;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);const hits=[.2,.5,.8].flatMap(fx=>[.2,.5,.8].map(fy=>{const hit=document.elementFromPoint(r.left+r.width*fx,r.top+r.height*fy);return Boolean(hit&&(hit===button||button.contains(hit)));}));return{index,rect:rect(r),width:c.width,minWidth:c.minWidth,minHeight:c.minHeight,aspectRatio:c.aspectRatio,opacity,hits,insideGrid:r.left>=g.left-.5&&r.right<=g.right+.5&&r.top>=g.top-.5&&r.bottom<=g.bottom+.5,insideClip:r.left>=left-.5&&r.right<=right+.5&&r.top>=top-.5&&r.bottom<=bottom+.5};});
   const intersections:Array<{a:number;b:number;width:number;height:number;overlap:boolean}>=[];for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){const x=Math.max(0,Math.min(rows[a].rect.right,rows[b].rect.right)-Math.max(rows[a].rect.left,rows[b].rect.left)),y=Math.max(0,Math.min(rows[a].rect.bottom,rows[b].rect.bottom)-Math.max(rows[a].rect.top,rows[b].rect.top));intersections.push({a,b,width:x,height:y,overlap:x>.5&&y>.5});}
   return{grid:rect(g),columns:css.gridTemplateColumns,columnGap:css.columnGap,rowGap:css.rowGap,clientWidth:grid.clientWidth,scrollWidth:grid.scrollWidth,scrollLeft:grid.scrollLeft,clip:{left,right,top,bottom},rows,intersections,ancestors};
  });
  expect(layout.rows.length).toBe(4);expect(layout.intersections.length).toBe(6);
  const defects:string[]=[];if(layout.scrollWidth>layout.clientWidth+1)defects.push('grid:horizontal-overflow');
  for(const row of layout.rows){if(row.rect.width<44||row.rect.height<44)defects.push('tile'+row.index+':small');if(row.opacity<.99)defects.push('tile'+row.index+':hidden');if(!row.insideGrid)defects.push('tile'+row.index+':outside-grid');if(!row.insideClip||!row.hits.every(Boolean))defects.push('tile'+row.index+':clipped-or-wrong-hit');}
  for(const pair of layout.intersections)if(pair.overlap)defects.push('tiles'+pair.a+'-'+pair.b+':overlap');
  const shot=path.join(SHOTS,theme+'-four-history.png');await s.page.screenshot({path:shot});console.log('OU_CAPTURE '+JSON.stringify({theme,path:shot}));
  let flowCompleted=false;if(defects.length===0){await nativeTap(tiles.nth(3));expect(await s.page.getByRole('img',{name:'首帧',exact:true}).getAttribute('src')).toBe(LAST);expect(await s.page.getByRole('img',{name:'尾帧',exact:true}).getAttribute('src')).toBe(FIRST);expect(await s.page.locator('[data-floating-panel="video"] textarea').first().inputValue()).toBe('离线四条历史4');flowCompleted=true;}
  const final=await s.page.evaluate(()=>window.ouFixture.snapshot());expect(final.history).toBe(baseline.history);expect(final.generations).toBe(0);expect(final.closes).toBe(0);expect(final.errors).toEqual([]);
  console.log('OU_HISTORY_OBSERVATION '+JSON.stringify({theme,device,layout,defects,flowCompleted,historyUnchanged:true,noAssetWrites:true,noRealModel:true,programmaticPositioning:true,nativeScrollAccepted:false,physicalAndroidAccepted:false}));
  expect(defects,'OU_FOUR_HISTORY_TILES_SEPARATE_REACHABLE').toEqual([]);expect(flowCompleted).toBe(true);
 });
},25000);
