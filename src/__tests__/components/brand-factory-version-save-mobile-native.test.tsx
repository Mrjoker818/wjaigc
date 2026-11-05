// @vitest-environment node
// BrandFactory version rejection and one accepted retry; synthetic transport only.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import {build} from 'esbuild';
import {compile} from 'tailwindcss';
import {Scanner} from '@tailwindcss/oxide';
import {chromium,type Browser,type BrowserContext,type Page,type Locator,type Request,type Route} from '@playwright/test';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createOwnedOperations,acquireOwned} from '../../../tests/helpers/native-owned-operations';

const ORIGIN='https://brand-factory-version-save-qi.invalid';
const SHOTS=path.resolve('output/playwright/brand-factory-version-save-qi-native',String(process.pid));
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import BrandFactoryPanel from '@/components/brand-factory-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={closes:0,adds:0,errors:[] as string[],mounted:false};
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:Error){state.errors.push(e.message);}
 render(){return this.state.failed?null:this.props.children;}
}

function png(color:string):string{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');if(!x)throw Error('QI_PNG_CONTEXT');x.fillStyle=color;x.fillRect(0,0,64,64);return c.toDataURL('image/png');}
const media={logo:png('#d97706'),product:png('#2563eb'),ip:png('#16a34a'),references:[png('#9333ea'),png('#dc2626')]};
const selection=JSON.stringify({model:'image0',providerId:'offline-image'});
Object.assign(window,{qiFactoryFixture:{state,media,
 mount(theme:string){if(state.mounted)throw Error('QI_REMOUNT');state.mounted=true;
  document.documentElement.classList.toggle('dark',theme==='gold');
  document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
  localStorage.setItem('wujie_selected_model',selection);
  root.render(<Boundary><BrandFactoryPanel isMonochrome={theme==='mono'} onClose={()=>{state.closes++;root.render(null);}}
   onAddImages={()=>{state.adds++;}} /></Boundary>);},
 unmount(){root.unmount();},
 snapshot(){return {...state,selection:localStorage.getItem('wujie_selected_model')};}
}});
`;
interface View{width:number;height:number}
interface Media{logo:string;product:string;ip:string;references:string[]}
interface Snapshot{closes:number;adds:number;errors:string[];mounted:boolean;selection:string|null}
declare global{interface Window{qiFactoryFixture:{media:Media;mount:(theme:string)=>void;unmount:()=>void;snapshot:()=>Snapshot}}}
interface Session{theme:string;view:View;media:Media;saveRequests:number;expectedSaveRequests:0|1|2;rejectedReceipts:number;acceptedReceipts:number;releaseSave:()=>void;saveGate:Promise<void>;counts:Map<string,number>;context:BrowserContext;page:Page;mounted:boolean;handlers:Set<Promise<void>>;pending:Set<Request>;faults:string[];requests:Array<{url:string;method:string;body:string|null}>}
let browser:Browser|undefined,bundle='',css='';const live=new Set<Session>();
const operations=createOwnedOperations(),contexts=new Set<BrowserContext>(),browsers=new Set<Browser>(),contextClosing=new Map<BrowserContext,Promise<void>>(),browserClosing=new Map<Browser,Promise<void>>();let closing=false;
function closeContext(context:BrowserContext):Promise<void>{let promise=contextClosing.get(context);if(!promise){promise=context.close();contextClosing.set(context,promise);}return promise;}
function closeBrowser(value:Browser):Promise<void>{let promise=browserClosing.get(value);if(!promise){promise=value.close();browserClosing.set(value,promise);}return promise;}
const template=(id:string,name:string):Record<string,string>=>({id,name,icon:'□',description:'离线模板',promptTemplate:'offline',negativePrompt:'',aspectRatio:'1:1',category:'product'});
async function bounded<T>(operation:()=>Promise<T>,ms:number,label:string):Promise<T>{return operations.run('QH-'+label,operation,ms);}
beforeAll(async():Promise<void>=>{
 const setupStarted=performance.now();
 await operations.run('QH-bundle-and-CSS',async()=>{
 if(fs.existsSync(SHOTS))throw Error('QI_OLD_SCREENSHOTS');fs.mkdirSync(SHOTS,{recursive:true});
 const require=createRequire(import.meta.url),files=['src/components/brand-factory-panel.tsx'];
 const compiler=await compile(fs.readFileSync('src/app/globals.css','utf8'),{base:process.cwd(),loadStylesheet:async(id:string,base:string)=>{
  const file=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?path.resolve('node_modules/tw-animate-css/dist/tw-animate.css'):require.resolve(id.startsWith('.')?path.resolve(base,id):id);
  return {path:file,base:path.dirname(file),content:fs.readFileSync(file,'utf8')};}});
 css=compiler.build(new Scanner({}).scanFiles(files.map(file=>({content:fs.readFileSync(file,'utf8'),extension:'tsx'}))));
 const output=await build({write:false,metafile:true,bundle:true,platform:'browser',format:'iife',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{contents:ENTRY,resolveDir:process.cwd(),loader:'tsx',sourcefile:'nd-secondary-browser-entry.tsx'}});
 bundle=output.outputFiles[0].text;
 },30000);
 if(closing||performance.now()-setupStarted>15000)throw Error('QI_SETUP_NATIVE_BUDGET_EXHAUSTED');
 browser=await acquireOwned(operations,'QH-launch',async()=>{const value=await chromium.launch({headless:true,timeout:15000});browsers.add(value);value.once('disconnected',()=>browsers.delete(value));return value;},closeBrowser,()=>closing,15000);
},30000);
afterAll(async():Promise<void>=>{
 closing=true;const errors:unknown[]=[];
 for(const r of await Promise.allSettled([...live].map(s=>dispose(s))))if(r.status==='rejected')errors.push(r.reason);
 for(const r of await Promise.allSettled([...contexts].map(c=>bounded(()=>closeContext(c),5000,'remaining-context-close'))))if(r.status==='rejected')errors.push(r.reason);
 for(const r of await Promise.allSettled([...browsers].map(b=>bounded(()=>closeBrowser(b),5000,'browser-close'))))if(r.status==='rejected')errors.push(r.reason);
 const pending=operations.pendingPromises();if(pending.length){try{await bounded(()=>Promise.allSettled(pending),2500,'actual-drain');}catch(e){errors.push(e);}}
 browser=undefined;const snapshot=operations.snapshot();console.log('QI_OWNED_OPERATIONS '+JSON.stringify(snapshot));
 if(contexts.size||browsers.size||snapshot.pending.length||snapshot.lateErrors.length||snapshot.operations.some(o=>!o.settled||o.timedOut||o.rejected))errors.push(Error('QI_ACTUAL_RESOURCE_CLOSE_UNKNOWN'));
 if(errors.length)throw new AggregateError(errors,'QI_FINAL_CLEANUP');
},20000);

const QI_PROJECT_ID='qi-synthetic-brand';
const QI_BRAND='QI 版本保存项目';
const QI_NOTE='QI version draft after rejection';
const QI_REJECTION='QI 合成保存被拒绝';
function expectedVersionSave(s:Session):Record<string,unknown>{
 return{action:'save-version',projectId:QI_PROJECT_ID,targetType:'dna',targetId:QI_PROJECT_ID,versionName:'V1',note:QI_NOTE,snapshot:{id:QI_PROJECT_ID,projectName:'合成项目',brandName:QI_BRAND,industry:'离线测试',projectType:'品牌升级',keywords:[],targetAudience:'',tone:'',description:'',logoUrl:s.media.logo,productUrl:s.media.product,ipUrl:s.media.ip,referenceUrls:s.media.references,brandDna:null,creativeDirections:[],kvImageUrl:'',batchResults:[],consistencyScores:null,status:'active',isArchived:false,createdAt:'2026-10-25T00:00:00Z',updatedAt:'2026-10-25T00:00:00Z'},imageModel:'image0',imageProviderId:'qi-provider',llmModel:'chat0',llmProviderId:'qi-provider'};
}
async function routeRequest(s:Session,route:Route):Promise<void>{
 const q=route.request(),u=new URL(q.url()),method=q.method(),body=q.postData(),h=q.headers();
 s.requests.push({url:q.url(),method,body});
 if(u.origin!==ORIGIN||u.username||u.password||h.authorization||h.cookie||h['x-api-key']||h['api-key']||h['idempotency-key'])throw Error('QI_HTTP_BOUNDARY');
 const key=method+' '+u.pathname+u.search,count=(s.counts.get(key)??0)+1;s.counts.set(key,count);
 if(key==='POST /api/brand-factory'?count>2||count>s.expectedSaveRequests:count!==1)throw Error('QI_EXACT_REQUEST_COUNT:'+key);
 if(method==='GET'&&body===null){
  if(key==='GET /'&&q.isNavigationRequest()){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'</style></head><body><div id="fixture-root"></div></body></html>'});return;}
  if(key==='GET /logo.png'&&q.resourceType()==='image'){await route.fulfill({contentType:'image/png',body:Buffer.from(s.media.logo.split(',')[1],'base64')});return;}
  if(key==='GET /api/brand-factory'){if(s.media.references.length!==2)throw Error('QI_TWO_DISTINCT_REFERENCES');await route.fulfill({json:{success:true,projects:[{id:QI_PROJECT_ID,project_name:'合成项目',brand_name:QI_BRAND,industry:'离线测试',project_type:'品牌升级',keywords:'[]',logo_url:s.media.logo,product_url:s.media.product,ip_url:s.media.ip,reference_urls:JSON.stringify(s.media.references),brand_dna:'null',creative_directions:'[]',batch_results:'[]',consistency_scores:'null',status:'active',is_archived:false,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'}]}});return;}
  if(key==='GET /api/models?type=image'||key==='GET /api/models?type=chat'){const type=u.searchParams.get('type');await route.fulfill({json:{models:[{id:type==='image'?'image0':'chat0',name:'离线模型',providerId:'qi-provider'}],providers:[{id:'qi-provider',name:'离线供应商'}]}});return;}
 }

 if(method==='POST'&&key==='POST /api/brand-factory'&&h['content-type']==='application/json'){
  let observed:unknown;try{observed=JSON.parse(body??'null');}catch{throw Error('QI_SAVE_JSON');}
  if(!isDeepStrictEqual(observed,expectedVersionSave(s)))throw Error('QI_EXACT_SAVE_BODY');
  s.saveRequests++;if(count===1){await route.fulfill({json:{success:false,error:QI_REJECTION}});s.rejectedReceipts++;return;}
  await s.saveGate;
  await route.fulfill({json:{success:true}});s.acceptedReceipts++;return;
 }
 throw Error('QI_UNEXPECTED_HTTP:'+key);
}
async function drain(s:Session):Promise<void>{const end=Date.now()+1500;while((s.handlers.size||s.pending.size)&&Date.now()<end)await new Promise<void>(resolve=>setTimeout(resolve,10));if(s.handlers.size||s.pending.size)throw Error('QI_NETWORK_NOT_DRAINED');}
async function open(theme:string,view:View):Promise<Session>{
 if(!browser||closing)throw Error('QI_NO_BROWSER');const owner={ended:false};
 const context:BrowserContext=await acquireOwned(operations,'QH-context-create',async()=>{const value=await browser!.newContext({serviceWorkers:'block',viewport:view,hasTouch:view.width<1000,isMobile:view.width<1000,reducedMotion:'reduce'});contexts.add(value);value.once('close',()=>contexts.delete(value));return value;},closeContext,()=>closing||owner.ended).catch(e=>{owner.ended=true;throw e;});
 let page:Page;try{page=await acquireOwned(operations,'QH-page-create',()=>context.newPage(),(value:Page)=>value.close(),()=>closing||owner.ended);}catch(e){owner.ended=true;await bounded(()=>closeContext(context),5000,'bootstrap-close');throw e;}
 page.setDefaultTimeout(1500);let releaseSave:()=>void=()=>{};const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;});const s:Session={theme,view,media:{logo:'',product:'',ip:'',references:[]},saveRequests:0,expectedSaveRequests:0,rejectedReceipts:0,acceptedReceipts:0,releaseSave,saveGate,counts:new Map(),context,page,mounted:false,handlers:new Set(),pending:new Set(),faults:[],requests:[]};live.add(s);
 page.on('pageerror',e=>s.faults.push('PAGE:'+e.message));page.on('console',m=>{if(m.type()==='error')s.faults.push('CONSOLE:'+m.text());});
 page.on('dialog',d=>{s.faults.push('DIALOG');void d.dismiss();});page.on('request',q=>s.pending.add(q));page.on('requestfinished',q=>s.pending.delete(q));page.on('requestfailed',q=>{s.pending.delete(q);s.faults.push('REQUEST_FAILED:'+q.url());});
 page.on('response',r=>{if(r.status()>=400)s.faults.push('HTTP_STATUS:'+r.status());});
 try{
  await context.routeWebSocket('**/*',socket=>{s.faults.push('WEBSOCKET');socket.close({code:1008,reason:'offline-only'});});
  await context.route('**/*',async route=>{const task=routeRequest(s,route);s.handlers.add(task);try{await task;}catch(e){s.faults.push(String(e));try{await route.abort('blockedbyclient');}catch(a){s.faults.push(String(a));}}finally{s.handlers.delete(task);}});
  await page.goto(ORIGIN+'/');await page.addScriptTag({content:bundle});s.media=await page.evaluate(()=>window.qiFactoryFixture.media);s.mounted=true;await page.evaluate(t=>window.qiFactoryFixture.mount(t),theme);
  await page.getByText(QI_BRAND,{exact:true}).waitFor();await drain(s);return s;
 }catch(e){try{await dispose(s);}catch(c){throw new AggregateError([e,c],'QI_BOOTSTRAP_AQI_CLEANUP');}throw e;}
}
function validateLedger(s:Session):void{
 const gets=['GET /','GET /logo.png','GET /api/brand-factory','GET /api/models?type=image','GET /api/models?type=chat'];
 const expected=[...gets,...Array.from({length:s.expectedSaveRequests},()=> 'POST /api/brand-factory')].sort();
 const requests=s.requests.map(q=>({key:q.method+' '+new URL(q.url).pathname+new URL(q.url).search,body:q.body}));
 expect(requests.map(q=>q.key).sort(),'QI exact actual request ledger').toEqual(expected);
 expect([...s.counts.keys()].sort(),'QI exact request keys').toEqual([...new Set(expected)].sort());
 for(const[key,count]of s.counts)expect(count,'QI exact request counts').toBe(key==='POST /api/brand-factory'?s.expectedSaveRequests:1);
 expect(s.saveRequests).toBe(s.expectedSaveRequests);expect(s.rejectedReceipts).toBe(s.expectedSaveRequests>0?1:0);expect(s.acceptedReceipts).toBe(s.expectedSaveRequests===2?1:0);
 for(const q of requests){if(q.key.startsWith('GET '))expect(q.body).toBeNull();else expect(JSON.parse(q.body??'null')).toEqual(expectedVersionSave(s));}
 console.log('QI_REQUEST_LEDGER',JSON.stringify({theme:s.theme,view:s.view,expectedSaveRequests:s.expectedSaveRequests,saveRequests:s.saveRequests,rejectedReceipts:s.rejectedReceipts,acceptedReceipts:s.acceptedReceipts,requests,counts:Object.fromEntries(s.counts),afterUnmount:!s.mounted,nativeDrained:s.pending.size===0&&s.handlers.size===0}));
}
async function dispose(s:Session):Promise<void>{
 s.releaseSave();
 const errors:string[]=[];try{if(s.mounted&&!s.page.isClosed()){await bounded(()=>s.page.evaluate(()=>window.qiFactoryFixture.unmount()),3000,'unmount');s.mounted=false;}await bounded(()=>Promise.all([...s.handlers]),3000,'routes');await drain(s);validateLedger(s);
  const state=await s.page.evaluate(()=>window.qiFactoryFixture.snapshot());errors.push(...state.errors);if(s.pending.size)errors.push('PENDING');
 }catch(e){errors.push(String(e));}finally{try{await bounded(()=>closeContext(s.context),5000,'context-close');}catch(e){errors.push(String(e));}live.delete(s);}
 if(errors.length||s.faults.length)throw Error('QI_INFRASTRUCTURE_ERROR:'+JSON.stringify({errors,faults:s.faults}));
}
async function withSession(theme:string,view:View,body:(s:Session)=>Promise<void>):Promise<void>{const s=await open(theme,view);let failed=false,cause:unknown,cleanupFailed=false,cleanup:unknown;try{await body(s);}catch(e){failed=true;cause=e;}try{await dispose(s);}catch(e){cleanupFailed=true;cleanup=e;}if(cleanupFailed)throw new AggregateError(failed?[cause,cleanup]:[cleanup],'QI_BODY_AND_CLEANUP');if(failed)throw cause;console.log('QI_CLEANUP_COMPLETE',JSON.stringify({theme,...view,saveRequests:s.saveRequests,rejectedReceipts:s.rejectedReceipts,acceptedReceipts:s.acceptedReceipts,nativeRequestsDrained:true,actualContextClosed:true,physicalAndroid:false}));}
async function tap(locator:Locator):Promise<void>{const r=await locator.boundingBox();expect(r,'QI_TARGET_EXISTS').not.toBeNull();expect(r!.width,'QI_TARGET_WIDTH').toBeGreaterThanOrEqual(44);expect(r!.height,'QI_TARGET_HEIGHT').toBeGreaterThanOrEqual(44);await locator.tap();}
async function geometry(locator:Locator):Promise<{fullyVisible:boolean;rect:{left:number;right:number;top:number;bottom:number};visible:{left:number;right:number;top:number;bottom:number};hits:boolean[]}>{
 return locator.evaluate(element=>{const r=element.getBoundingClientRect(),rect={left:r.left,right:r.right,top:r.top,bottom:r.bottom},visible={left:0,right:innerWidth,top:0,bottom:innerHeight};
  for(let parent=element.parentElement;parent;parent=parent.parentElement){const c=getComputedStyle(parent),p=parent.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(c.overflowX)){visible.left=Math.max(visible.left,p.left+parent.clientLeft);visible.right=Math.min(visible.right,p.left+parent.clientLeft+parent.clientWidth);}if(/hidden|clip|scroll|auto/.test(c.overflowY)){visible.top=Math.max(visible.top,p.top+parent.clientTop);visible.bottom=Math.min(visible.bottom,p.top+parent.clientTop+parent.clientHeight);}}
  const hits=[r.left+7,(r.left+r.right)/2,r.right-7].flatMap(x=>[r.top+7,(r.top+r.bottom)/2,r.bottom-7].map(y=>{const hit=document.elementFromPoint(x,y);return Boolean(hit&&(hit===element||element.contains(hit)));}));
  return {rect,visible,hits,fullyVisible:r.width>0&&r.height>0&&r.left>=visible.left-1&&r.right<=visible.right+1&&r.top>=visible.top-1&&r.bottom<=visible.bottom+1&&hits.every(Boolean)};
 });
}

async function settle(s:Session):Promise<void>{await s.page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));}
function panel(s:Session):Locator{return s.page.locator('[data-floating-panel="true"]');}
async function reveal(s:Session,control:Locator,axis:'x'|'y'='y'):Promise<void>{
 for(let i=0;i<16;i++){
  const state=await control.evaluate((el,axis)=>{const r=el.getBoundingClientRect();for(let p=el.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),overflow=axis==='y'?c.overflowY:c.overflowX,capacity=axis==='y'?p.scrollHeight-p.clientHeight:p.scrollWidth-p.clientWidth;if(['auto','scroll'].includes(overflow)&&capacity>1){const b=p.getBoundingClientRect();return{rect:{start:axis==='y'?r.top:r.left,end:axis==='y'?r.bottom:r.right},owner:{left:Math.max(4,b.left+4),right:Math.min(innerWidth-4,b.right-4),top:Math.max(4,b.top+4),bottom:Math.min(innerHeight-4,b.bottom-4)}};}}return{rect:{start:axis==='y'?r.top:r.left,end:axis==='y'?r.bottom:r.right},owner:null};},axis);
  if(!state.owner)return;
  const b=state.owner,start=axis==='y'?b.top:b.left,end=axis==='y'?b.bottom:b.right;
  if(state.rect.start>=start&&state.rect.end<=end)return;
  const length=end-start,delta=(state.rect.start<start?1:-1)*Math.min(180,length-32);
  if(length<60)throw Error('QI_NATIVE_SCROLL_OWNER_TOO_SHORT');
  if(s.view.width>=1000){await s.page.mouse.move(b.right-8,b.bottom-8);await s.page.mouse.wheel(axis==='x'?-delta:0,axis==='y'?-delta:0);await settle(s);continue;}
  const x=axis==='y'?b.right-8:delta<0?b.right-16:b.left+16,y=axis==='x'?b.bottom-8:delta<0?b.bottom-16:b.top+16;
  await bounded(async()=>{const c=await s.context.newCDPSession(s.page);try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,force:1}]});try{for(const t of[.25,.5,.75,1]){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(axis==='x'?delta*t:0),y:y+(axis==='y'?delta*t:0),id:1,force:1}]});await settle(s);}}finally{await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}}finally{await c.detach();}},2500,'native-swipe');
  await settle(s);
 }
 throw Error('QI_NATIVE_REVEAL_BOUND');
}
async function activate(s:Session,control:Locator,axis:'x'|'y'='y'):Promise<void>{await reveal(s,control,axis);const r=await control.boundingBox();expect(r).not.toBeNull();expect(r!.width,'QH target width').toBeGreaterThanOrEqual(44);expect(r!.height,'QH target height').toBeGreaterThanOrEqual(44);expect((await geometry(control)).fullyVisible,'QH full target and native hits').toBe(true);if(s.view.width<1000)await control.tap();else await control.click();await settle(s);}

async function capture(s:Session,theme:string,stage:string):Promise<void>{const file=path.join(SHOTS,theme+'-'+s.view.width+'-'+s.view.height+'-'+stage+'.png');await bounded(()=>s.page.screenshot({path:file}),3000,'capture');console.log('QI_CAPTURE',JSON.stringify({theme,view:s.view,stage,path:file,physicalAndroid:false}));}
function records(s:Session):Locator{return panel(s).getByText(/^V[1-9]\d*$/);}
const CASES=['gold','mono'].flatMap(theme=>[[320,640],[390,844],[640,320],[1040,720]].map(([width,height])=>({theme,width,height})));
for(const {theme,width,height}of CASES)it('QI '+theme+' '+width+'x'+height+' rejected version save retains history and draft then accepts one retry',async():Promise<void>=>{
 await withSession(theme,{width,height},async s=>{
  await activate(s,panel(s).getByText(QI_BRAND,{exact:true}).locator('../..'));
  await activate(s,panel(s).getByRole('button',{name:'版本管理',exact:true}),'x');
  const baseline=await s.page.evaluate(()=>window.qiFactoryFixture.snapshot()),note=panel(s).getByPlaceholder('版本备注',{exact:true}),save=panel(s).getByRole('button',{name:'保存当前版本',exact:true});
  expect(await records(s).count()).toBe(0);
  await activate(s,note);await bounded(()=>note.pressSequentially(QI_NOTE,{timeout:1500}),2000,'native-note');expect(await note.inputValue()).toBe(QI_NOTE);
  s.expectedSaveRequests=1;await activate(s,save);await panel(s).getByText(QI_REJECTION,{exact:true}).waitFor();await settle(s);
  const rejected={theme,view:s.view,device:await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,hoverAvailable:matchMedia('(hover:hover)').matches})),historyCount:await records(s).count(),note:await note.inputValue(),errorVisible:await panel(s).getByText(QI_REJECTION,{exact:true}).isVisible(),disabled:await save.isDisabled(),saveRequests:s.saveRequests};
  console.log('QI_REJECTED_SAVE_STATE',JSON.stringify(rejected));
  await reveal(s,panel(s).getByText('版本历史',{exact:true}));await capture(s,theme,'rejected');
  expect(rejected.historyCount,'QI rejected save does not create a version').toBe(0);
  expect(rejected.note,'QI rejected save retains typed note').toBe(QI_NOTE);expect(rejected.errorVisible).toBe(true);expect(rejected.disabled).toBe(false);expect(s.saveRequests).toBe(1);
  s.expectedSaveRequests=2;await activate(s,save);await expect.poll(()=>s.saveRequests,{timeout:1500}).toBe(2);
  expect(await save.isDisabled(),'QI pending save is disabled').toBe(true);expect(await save.getAttribute('aria-busy'),'QI pending save exposes busy state').toBe('true');expect(await records(s).count()).toBe(0);expect(await note.inputValue()).toBe(QI_NOTE);
  const point=await save.boundingBox();expect(point).not.toBeNull();expect((await geometry(save)).fullyVisible).toBe(true);
  if(width<1000)await s.page.touchscreen.tap(point!.x+point!.width/2,point!.y+point!.height/2);else await s.page.mouse.click(point!.x+point!.width/2,point!.y+point!.height/2);await settle(s);
  expect(s.saveRequests,'QI duplicate native tap while pending does not resubmit').toBe(2);console.log('QI_PENDING_SAVE_STATE',JSON.stringify({theme,view:s.view,saveRequests:s.saveRequests,disabled:await save.isDisabled(),busy:await save.getAttribute('aria-busy'),historyCount:await records(s).count(),note:await note.inputValue()}));await capture(s,theme,'pending');
  s.releaseSave();await expect.poll(()=>s.acceptedReceipts,{timeout:1500}).toBe(1);await panel(s).getByText('V1',{exact:true}).waitFor();await settle(s);
  expect(await records(s).count(),'QI one accepted retry produces exactly one local row').toBe(1);expect(await note.inputValue()).toBe('');expect(await save.isEnabled()).toBe(true);expect(await save.getAttribute('aria-busy')).toBe('false');expect(await panel(s).getByText(QI_REJECTION,{exact:true}).count()).toBe(0);expect(await panel(s).getByText(QI_NOTE,{exact:true}).count()).toBe(1);
  await reveal(s,panel(s).getByText('V1',{exact:true}));await capture(s,theme,'accepted');
  await activate(s,s.page.getByRole('button',{name:'最小化品牌工厂',exact:true}));await activate(s,s.page.getByRole('button',{name:'展开品牌工厂',exact:true}));expect(await records(s).count()).toBe(1);
  await activate(s,s.page.getByRole('button',{name:'关闭品牌工厂',exact:true}));expect(await panel(s).count()).toBe(0);expect(await s.page.evaluate(()=>window.qiFactoryFixture.snapshot())).toEqual({...baseline,closes:1});
  await drain(s);expect(s.saveRequests).toBe(2);expect(s.rejectedReceipts).toBe(1);expect(s.acceptedReceipts).toBe(1);
  console.log('QI_BODY_COMPLETE',JSON.stringify({theme,view:s.view,rejectedHistoryRetained:true,rejectedNoteRetained:true,pendingDuplicateSuppressed:true,saveRequests:2,oneAcceptedLocalVersion:true,noteClearedAfterSuccess:true,minimizeRetainsRow:true,closed:true,noGeneration:true,noUpload:true,physicalAndroid:false,realPersistenceAccepted:false,projectSwitchAccepted:false,cloud:false}));
 });
},25000);
