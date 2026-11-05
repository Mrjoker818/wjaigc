// @vitest-environment node
// New populated settings coverage; synthetic local draft actions, no persisted asset writes.
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

const ORIGIN='https://brand-secondary-mobile.invalid';
const SHOTS=path.resolve('output/playwright/brand-gallery-populated-mobile-native',String(process.pid));
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrandEcommercePanel} from '@/components/brand-ecommerce-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={closes:0,adds:0,errors:[] as string[],mounted:false,added:[] as Array<{urls:string[];meta:{modelName?:string;apiProvider?:string}}>};
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:Error){state.errors.push(e.message);}
 render(){return this.state.failed?null:this.props.children;}
}
const selection=JSON.stringify({model:'image0',providerId:'offline-image'});
Object.assign(window,{olFixture:{state,
 mount(theme:string){if(state.mounted)throw Error('ND_REMOUNT');state.mounted=true;
  document.documentElement.classList.toggle('dark',theme==='gold');
  document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
  localStorage.setItem('wujie_selected_model',selection);
  root.render(<Boundary><BrandEcommercePanel isMonochrome={theme==='mono'} onClose={()=>{state.closes++;root.render(null);}}
   onAddImages={(urls,meta)=>{state.adds++;state.added.push({urls:[...urls],meta:{...meta}});}} /></Boundary>);},
 unmount(){root.unmount();},
 snapshot(){return {...state,selection:localStorage.getItem('wujie_selected_model')};}
}});
`;
interface Snapshot{closes:number;adds:number;errors:string[];mounted:boolean;selection:string|null;added:Array<{urls:string[];meta:{modelName?:string;apiProvider?:string}}>}
declare global{interface Window{olFixture:{mount:(theme:string)=>void;unmount:()=>void;snapshot:()=>Snapshot}}}
interface Session{context:BrowserContext;page:Page;mounted:boolean;handlers:Set<Promise<void>>;pending:Set<Request>;faults:string[];requests:Array<{url:string;method:string;body:string|null}>}
let browser:Browser|undefined,bundle='',css='';const live=new Set<Session>();
const operations=createOwnedOperations(),contexts=new Set<BrowserContext>(),browsers=new Set<Browser>(),contextClosing=new Map<BrowserContext,Promise<void>>(),browserClosing=new Map<Browser,Promise<void>>();let closing=false;
function closeContext(context:BrowserContext):Promise<void>{let promise=contextClosing.get(context);if(!promise){promise=context.close();contextClosing.set(context,promise);}return promise;}
function closeBrowser(value:Browser):Promise<void>{let promise=browserClosing.get(value);if(!promise){promise=value.close();browserClosing.set(value,promise);}return promise;}
const template=(id:string,name:string):Record<string,string>=>({id,name,icon:'□',description:'离线模板',promptTemplate:'offline',negativePrompt:'',aspectRatio:'1:1',category:'product'});
async function bounded<T>(operation:()=>Promise<T>,ms:number,label:string):Promise<T>{return operations.run('ND-'+label,operation,ms);}
beforeAll(async():Promise<void>=>{
 const setupStarted=performance.now();
 await operations.run('ND-bundle-and-CSS',async()=>{
 if(fs.existsSync(SHOTS))throw Error('ND_OLD_SCREENSHOTS');fs.mkdirSync(SHOTS,{recursive:true});
 const require=createRequire(import.meta.url),files=['src/components/brand-ecommerce-panel.tsx',...['BrandTemplateSelector','BrandSettingsForm','BrandResultGallery','BrandAssetManager'].map(f=>'src/components/brand-ecommerce/'+f+'.tsx'),'src/components/brand-ecommerce/template-fields.ts','src/components/ui/popover.tsx'];
 const compiler=await compile(fs.readFileSync('src/app/globals.css','utf8'),{base:process.cwd(),loadStylesheet:async(id:string,base:string)=>{
  const file=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?path.resolve('node_modules/tw-animate-css/dist/tw-animate.css'):require.resolve(id.startsWith('.')?path.resolve(base,id):id);
  return {path:file,base:path.dirname(file),content:fs.readFileSync(file,'utf8')};}});
 css=compiler.build(new Scanner({}).scanFiles(files.map(file=>({content:fs.readFileSync(file,'utf8'),extension:'tsx'}))));
 const output=await build({write:false,metafile:true,bundle:true,platform:'browser',format:'iife',target:'es2022',absWorkingDir:process.cwd(),tsconfig:'tsconfig.json',stdin:{contents:ENTRY,resolveDir:process.cwd(),loader:'tsx',sourcefile:'nd-secondary-browser-entry.tsx'}});
 bundle=output.outputFiles[0].text;
 },30000);
 if(closing||performance.now()-setupStarted>15000)throw Error('ND_SETUP_NATIVE_BUDGET_EXHAUSTED');
 browser=await acquireOwned(operations,'ND-launch',async()=>{const value=await chromium.launch({headless:true,timeout:15000});browsers.add(value);value.once('disconnected',()=>browsers.delete(value));return value;},closeBrowser,()=>closing,15000);
},30000);
afterAll(async():Promise<void>=>{
 closing=true;const errors:unknown[]=[];
 for(const r of await Promise.allSettled([...live].map(s=>dispose(s))))if(r.status==='rejected')errors.push(r.reason);
 for(const r of await Promise.allSettled([...contexts].map(c=>bounded(()=>closeContext(c),5000,'remaining-context-close'))))if(r.status==='rejected')errors.push(r.reason);
 for(const r of await Promise.allSettled([...browsers].map(b=>bounded(()=>closeBrowser(b),5000,'browser-close'))))if(r.status==='rejected')errors.push(r.reason);
 const pending=operations.pendingPromises();if(pending.length){try{await bounded(()=>Promise.allSettled(pending),2500,'actual-drain');}catch(e){errors.push(e);}}
 browser=undefined;const snapshot=operations.snapshot();console.log('ND_OWNED_OPERATIONS '+JSON.stringify(snapshot));
 if(contexts.size||browsers.size||snapshot.pending.length||snapshot.lateErrors.length||snapshot.operations.some(o=>!o.settled||o.timedOut||o.rejected))errors.push(Error('ND_ACTUAL_RESOURCE_CLOSE_UNKNOWN'));
 if(errors.length)throw new AggregateError(errors,'ND_FINAL_CLEANUP');
},20000);
async function routeRequest(s:Session,route:Route):Promise<void>{
 const q=route.request(),u=new URL(q.url()),method=q.method(),body=q.postData(),h=q.headers();
 s.requests.push({url:q.url(),method,body});
 if(u.origin!==ORIGIN||u.username||u.password||h.authorization||h.cookie||h['x-api-key']||h['api-key'])throw Error('ND_HTTP_BOUNDARY');
 const key=u.pathname+u.search;
 if(!olAllowed({url:q.url(),method,postData:body,credentialHeaders:false,idempotencyKey:h['idempotency-key']??null}))throw Error('OL_HTTP_SEMANTIC_BOUNDARY');
 if(method==='GET'&&body===null){
  if(key==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'</style></head><body><div id="fixture-root"></div></body></html>'});return;}
  if(key==='/api/brand-assets?userId=default'){await route.fulfill({json:{success:true,assets:OG_ASSETS}});return;}
  if(key==='/api/models?type=image'){await route.fulfill({json:{models:[{id:'image0',name:'离线图像模型',providerId:'offline-image'}],providers:[{id:'offline-image',name:'离线图像供应商',baseUrl:'https://provider.invalid',apiKeyPreview:''}]}});return;}
  if(key==='/api/models?type=chat'){await route.fulfill({json:{models:[{id:'chat0',name:'离线视觉模型',providerId:'offline-chat'}],providers:[{id:'offline-chat',name:'离线视觉供应商',baseUrl:'https://provider.invalid',apiKeyPreview:''}]}});return;}
 }
 if(method==='POST'&&key==='/api/brand-ecommerce'&&body==='{"action":"templates"}'){
  await route.fulfill({json:{success:true,templates:[template('white-bg','离线白底主图'),template('scene-lifestyle','离线场景图')]}});return;
 }
 if(method==='POST'&&key==='/api/brand-ecommerce'&&body===OL_BODY){await route.fulfill({json:{success:true,results:OL_RESULTS}});return;}
 throw Error('ND_UNEXPECTED_HTTP:'+method+' '+key);
}
async function drain(s:Session):Promise<void>{const end=Date.now()+1500;while((s.handlers.size||s.pending.size)&&Date.now()<end)await new Promise<void>(resolve=>setTimeout(resolve,10));if(s.handlers.size||s.pending.size)throw Error('ND_NETWORK_NOT_DRAINED');}
async function open(theme:string):Promise<Session>{
 if(!browser||closing)throw Error('ND_NO_BROWSER');const owner={ended:false};
 const context:BrowserContext=await acquireOwned(operations,'ND-context-create',async()=>{const value=await browser!.newContext({serviceWorkers:'block',viewport:{width:320,height:640},hasTouch:true,isMobile:true});contexts.add(value);value.once('close',()=>contexts.delete(value));return value;},closeContext,()=>closing||owner.ended).catch(e=>{owner.ended=true;throw e;});
 let page:Page;try{page=await acquireOwned(operations,'ND-page-create',()=>context.newPage(),(value:Page)=>value.close(),()=>closing||owner.ended);}catch(e){owner.ended=true;await bounded(()=>closeContext(context),5000,'bootstrap-close');throw e;}
 page.setDefaultTimeout(1500);const s:Session={context,page,mounted:false,handlers:new Set(),pending:new Set(),faults:[],requests:[]};live.add(s);
 page.on('pageerror',e=>s.faults.push('PAGE:'+e.message));page.on('console',m=>{if(m.type()==='error')s.faults.push('CONSOLE:'+m.text());});
 page.on('dialog',d=>{s.faults.push('DIALOG');void d.dismiss();});page.on('request',q=>s.pending.add(q));page.on('requestfinished',q=>s.pending.delete(q));page.on('requestfailed',q=>{s.pending.delete(q);s.faults.push('REQUEST_FAILED:'+q.url());});
 page.on('response',r=>{if(r.status()>=400)s.faults.push('HTTP_STATUS:'+r.status());});
 try{
  await context.routeWebSocket('**/*',socket=>{s.faults.push('WEBSOCKET');socket.close({code:1008,reason:'offline-only'});});
  await context.route('**/*',async route=>{const task=routeRequest(s,route);s.handlers.add(task);try{await task;}catch(e){s.faults.push(String(e));try{await route.abort('blockedbyclient');}catch(a){s.faults.push(String(a));}}finally{s.handlers.delete(task);}});
  await page.goto(ORIGIN+'/');await page.addScriptTag({content:bundle});s.mounted=true;await page.evaluate(t=>window.olFixture.mount(t),theme);
  await page.getByText('离线白底主图',{exact:true}).waitFor();await drain(s);return s;
 }catch(e){try{await dispose(s);}catch(c){throw new AggregateError([e,c],'ND_BOOTSTRAP_AND_CLEANUP');}throw e;}
}
async function dispose(s:Session):Promise<void>{
 const errors:string[]=[];try{if(s.mounted&&!s.page.isClosed()){await bounded(()=>s.page.evaluate(()=>window.olFixture.unmount()),3000,'unmount');s.mounted=false;}await bounded(()=>Promise.all([...s.handlers]),3000,'routes');await drain(s);
  const state=await s.page.evaluate(()=>window.olFixture.snapshot());errors.push(...state.errors);if(s.pending.size)errors.push('PENDING');
 }catch(e){errors.push(String(e));}finally{try{await bounded(()=>closeContext(s.context),5000,'context-close');}catch(e){errors.push(String(e));}live.delete(s);}
 if(errors.length||s.faults.length)throw Error('ND_INFRASTRUCTURE_ERROR:'+JSON.stringify({errors,faults:s.faults}));
}
async function withSession(theme:string,body:(s:Session)=>Promise<void>):Promise<void>{const s=await open(theme);let failed=false,cause:unknown,cleanupFailed=false,cleanup:unknown;try{await body(s);}catch(e){failed=true;cause=e;}try{await dispose(s);}catch(e){cleanupFailed=true;cleanup=e;}if(cleanupFailed)throw new AggregateError(failed?[cause,cleanup]:[cleanup],'ND_BODY_AND_CLEANUP');if(failed)throw cause;}
async function tap(locator:Locator):Promise<void>{const r=await locator.boundingBox();expect(r,'ND_TARGET_EXISTS').not.toBeNull();expect(r!.width,'ND_TARGET_WIDTH').toBeGreaterThanOrEqual(44);expect(r!.height,'ND_TARGET_HEIGHT').toBeGreaterThanOrEqual(44);await locator.tap();}
async function geometry(locator:Locator):Promise<{fullyVisible:boolean;rect:{left:number;right:number;top:number;bottom:number};visible:{left:number;right:number;top:number;bottom:number};hits:boolean[]}>{
 return locator.evaluate(element=>{const r=element.getBoundingClientRect(),rect={left:r.left,right:r.right,top:r.top,bottom:r.bottom},visible={left:0,right:innerWidth,top:0,bottom:innerHeight};
  for(let parent=element.parentElement;parent;parent=parent.parentElement){const c=getComputedStyle(parent),p=parent.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(c.overflowX)){visible.left=Math.max(visible.left,p.left+parent.clientLeft);visible.right=Math.min(visible.right,p.left+parent.clientLeft+parent.clientWidth);}if(/hidden|clip|scroll|auto/.test(c.overflowY)){visible.top=Math.max(visible.top,p.top+parent.clientTop);visible.bottom=Math.min(visible.bottom,p.top+parent.clientTop+parent.clientHeight);}}
  const hits=[r.left+7,(r.left+r.right)/2,r.right-7].flatMap(x=>[r.top+7,(r.top+r.bottom)/2,r.bottom-7].map(y=>{const hit=document.elementFromPoint(x,y);return Boolean(hit&&(hit===element||element.contains(hit)));}));
  return {rect,visible,hits,fullyVisible:r.width>0&&r.height>0&&r.left>=visible.left-1&&r.right<=visible.right+1&&r.top>=visible.top-1&&r.bottom<=visible.bottom+1&&hits.every(Boolean)};
 });
}
const OL_BODY=JSON.stringify({action:'generate',templateIds:['white-bg','scene-lifestyle'],productDesc:'离线完整结果面板验证',styleExtra:'',sceneDesc:'modern minimalist interior',model:'image0',providerId:'offline-image',llmModel:'chat0',llmProviderId:'offline-chat',referenceImageUrl:'',productImageUrl:'',brandColors:[],variantCount:2,templateFieldValues:{}});
const OL_IMAGE_A='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4st78PwgzwBgAYgQK5f/y4U4AAAAASUVORK5CYII=';
const OL_IMAGE_B='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQTX79H4QZYAwAUe4JyWDrWCIAAAAASUVORK5CYII=';
const OL_TITLE='离线结果长标题用于窄屏完整排版ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const OL_ERROR='OFFLINE_FAILURE_'+ 'x'.repeat(100)+'\n离线错误说明：不得截断或误当成功图片添加。';
const OG_ASSETS:unknown[]=[];
const OL_RESULTS=[{templateId:'white-bg',templateName:OL_TITLE,imageUrl:OL_IMAGE_A,aspectRatio:'1:1',variantIndex:0,providerId:'offline-image',providerName:'离线图像供应商',modelName:'image0'},{templateId:'white-bg',templateName:OL_TITLE,imageUrl:OL_IMAGE_B,aspectRatio:'1:1',variantIndex:1,providerId:'offline-image',providerName:'离线图像供应商',modelName:'image0'},{templateId:'scene-lifestyle',templateName:'离线错误分组',error:OL_ERROR,variantIndex:0,providerId:'offline-image',providerName:'离线图像供应商',modelName:'image0'}];
function olAllowed(q:{url:string;method:string;postData:string|null;credentialHeaders:boolean;idempotencyKey:string|null}):boolean{
 try{const u=new URL(q.url),key=u.pathname+u.search;if(u.origin!==ORIGIN||u.username||u.password||u.hash||q.credentialHeaders)return false;
 if(q.method==='GET')return q.postData===null&&q.idempotencyKey===null&&['/','/api/models?type=image','/api/models?type=chat','/api/brand-assets?userId=default'].includes(key);
 if(q.method!=='POST'||key!=='/api/brand-ecommerce')return false;
 return q.postData==='{"action":"templates"}'&&q.idempotencyKey===null||q.postData===OL_BODY&&typeof q.idempotencyKey==='string'&&/^brand-ecommerce:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(q.idempotencyKey);
 }catch{return false;}
}

interface OlAction{id:string;opacity:number;width:number;height:number;visible:boolean;horizontalReachableBeforePositioning:boolean;whiteSpace:string}
async function action(control:Locator,id:string):Promise<OlAction>{
 const horizontalReachableBeforePositioning=await control.evaluate(e=>{const r=e.getBoundingClientRect();let left=0,right=innerWidth;for(let p=e.parentElement;p;p=p.parentElement){if(/hidden|clip|scroll|auto/.test(getComputedStyle(p).overflowX)){const b=p.getBoundingClientRect();left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}}return r.left>=left-1&&r.right<=right+1;});
 await control.scrollIntoViewIfNeeded({timeout:1500});const shape=await geometry(control);
 return {id,visible:shape.fullyVisible,horizontalReachableBeforePositioning,...await control.evaluate(e=>{const r=e.getBoundingClientRect();let opacity=1;for(let n:Element|null=e;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return{opacity,width:r.width,height:r.height,whiteSpace:getComputedStyle(e).whiteSpace};})};
}
for(const theme of ['gold','mono'] as const)it('OL '+theme+' 320x640 actual parent nonempty gallery preserves single batch identity and long result controls',async():Promise<void>=>{
 await withSession(theme,async s=>{
  const baseline=await s.page.evaluate(()=>window.olFixture.snapshot()),device=await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,hover:matchMedia('(hover:hover)').matches}));
  expect(device).toMatchObject({width:320,height:640,coarse:true,hover:false});expect(device.touch).toBeGreaterThan(0);
  await tap(s.page.getByRole('button',{name:'全选',exact:true}));await tap(s.page.getByRole('button',{name:'生成设置',exact:true}));
  const description=s.page.getByPlaceholder('描述你的商品，如：高端无线降噪耳机，磨砂黑色，金属质感...',{exact:true});await tap(description);await s.page.keyboard.type('离线完整结果面板验证');
  await tap(s.page.getByRole('button',{name:'批量生成',exact:true}));
  const first=s.page.getByAltText(OL_TITLE+' 变体1',{exact:true}),second=s.page.getByAltText(OL_TITLE+' 变体2',{exact:true});
  await first.waitFor();await second.waitFor();await drain(s);
  const rows:OlAction[]=[];
  for(const [image,id] of [[first,'single-first'],[second,'single-second']] as const){
   expect(await image.evaluate(async e=>{await(e as HTMLImageElement).decode();return(e as HTMLImageElement).naturalWidth;})).toBe(2);
   rows.push(await action(image.locator('..').getByRole('button',{name:'画布',exact:true}),id));
  }
  const retries=s.page.getByRole('button',{name:'重新生成',exact:true});expect(await retries.count()).toBe(2);
  rows.push(await action(retries.nth(0),'retry-long-title'));rows.push(await action(retries.nth(1),'retry-error-title'));
  const error=s.page.getByRole('alert');expect(await error.count()).toBe(1);expect(await error.textContent()).toBe(OL_ERROR);
  await error.scrollIntoViewIfNeeded({timeout:1500});const errorGeometry=await error.evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};});
  await second.scrollIntoViewIfNeeded({timeout:1500});const before=path.join(SHOTS,theme+'-gallery-before-actions.png');await s.page.screenshot({path:before});console.log('OL_CAPTURE '+JSON.stringify({theme,phase:'before-actions',path:before}));
  // Off-center image tap checks the public image handler, not the center overlay button.
  await first.scrollIntoViewIfNeeded({timeout:1500});const imageRect=await first.boundingBox();expect(imageRect).not.toBeNull();const x=imageRect!.x+imageRect!.width-12,y=imageRect!.y+imageRect!.height-12;
  const imagePointProof=await first.evaluate((image,p)=>{
   const r=image.getBoundingClientRect(),card=image.parentElement,overlay=image.nextElementSibling,hit=document.elementFromPoint(p.x,p.y);let left=0,right=innerWidth,top=0,bottom=innerHeight;
   for(let parent=image.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent),b=parent.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(css.overflowX)){left=Math.max(left,b.left+parent.clientLeft);right=Math.min(right,b.left+parent.clientLeft+parent.clientWidth);}if(/hidden|clip|scroll|auto/.test(css.overflowY)){top=Math.max(top,b.top+parent.clientTop);bottom=Math.min(bottom,b.top+parent.clientTop+parent.clientHeight);}}
   const visible=p.x>=Math.max(left,r.left)&&p.x<Math.min(right,r.right)&&p.y>=Math.max(top,r.top)&&p.y<Math.min(bottom,r.bottom),sameCard=Boolean(card&&hit&&card.contains(hit)),imageHit=hit===image,ownOverlayHit=Boolean(overlay&&overlay.parentElement===card&&hit===overlay),otherInteractive=Boolean(hit?.closest('button,a,input,select,textarea,[role="button"],[role="link"]')),singleImageCard=card?.querySelectorAll('img').length===1;
   return {visible,sameCard,imageHit,ownOverlayHit,otherInteractive,singleImageCard,acceptedForInput:visible&&sameCard&&singleImageCard&&(imageHit||ownOverlayHit)&&!otherInteractive};
  },{x,y});
  expect(imagePointProof.acceptedForInput,'OL_IMAGE_POINT_VALIDATED_BEFORE_INPUT').toBe(true);const imageHit=imagePointProof.imageHit;
  await s.page.touchscreen.tap(x,y);const afterImage=await s.page.evaluate(()=>window.olFixture.snapshot());
  const secondButton=second.locator('..').getByRole('button',{name:'画布',exact:true});await secondButton.scrollIntoViewIfNeeded({timeout:1500});await tap(secondButton);
  const afterSingle=await s.page.evaluate(()=>window.olFixture.snapshot());
  const batch=s.page.getByRole('button',{name:'全部添加到画布 (2)',exact:true});await batch.scrollIntoViewIfNeeded({timeout:1500});rows.push(await action(batch,'batch-add'));await tap(batch);
  const afterBatch=await s.page.evaluate(()=>window.olFixture.snapshot());
  const after=path.join(SHOTS,theme+'-gallery-after-actions.png');await s.page.screenshot({path:after});console.log('OL_CAPTURE '+JSON.stringify({theme,phase:'after-actions',path:after}));
  await tap(s.page.getByRole('button',{name:'关闭品牌电商',exact:true}));const final=await s.page.evaluate(()=>window.olFixture.snapshot());await drain(s);
  expect(final.closes).toBe(1);expect(final.errors).toEqual([]);expect(final.selection).toBe(baseline.selection);
  expect(s.requests.map(q=>q.method+' '+new URL(q.url).pathname+new URL(q.url).search).sort()).toEqual(['GET /','GET /api/brand-assets?userId=default','GET /api/models?type=chat','GET /api/models?type=image','POST /api/brand-ecommerce','POST /api/brand-ecommerce'].sort());
  expect(s.requests.filter(q=>q.method==='POST').map(q=>q.body)).toEqual(['{"action":"templates"}',OL_BODY]);
  const meta={modelName:'image0',apiProvider:'offline-image'},expectedAdded=[{urls:[OL_IMAGE_A],meta},{urls:[OL_IMAGE_B],meta},{urls:[OL_IMAGE_A,OL_IMAGE_B],meta}];
  const defects:string[]=[];
  for(const row of rows){if(row.opacity<.99)defects.push(row.id+':opacity='+row.opacity);if(row.width<44||row.height<44)defects.push(row.id+':small-target');if(!row.visible||!row.horizontalReachableBeforePositioning)defects.push(row.id+':clipped');}
  if(!imageHit)defects.push('image-body:occluded');if(afterImage.adds!==1)defects.push('image-body:did-not-add-once');
  const callbackIdentity=afterBatch.added.length===expectedAdded.length&&afterBatch.added.every((value,i)=>value.urls.length===expectedAdded[i].urls.length&&value.urls.every((url,j)=>url===expectedAdded[i].urls[j])&&value.meta.modelName===expectedAdded[i].meta.modelName&&value.meta.apiProvider===expectedAdded[i].meta.apiProvider);
  if(afterSingle.adds!==2)defects.push('single-button:wrong-count');if(afterBatch.adds!==3||!callbackIdentity)defects.push('canvas-callback:identity-or-count');
  if(errorGeometry.left<0||errorGeometry.right>320||errorGeometry.scrollWidth>errorGeometry.clientWidth+1)defects.push('error:overflow');
  console.log('OL_GALLERY_OBSERVATION '+JSON.stringify({theme,device,rows,errorPreserved:true,errorGeometry,imageHit,imagePointProof,afterImage,afterSingle,afterBatch,final,defects,onlySyntheticGeneration:true,noAssetWrites:true,noRealModel:true,noRealCanvasMutation:true,nativeScrollAccepted:false,physicalAndroidAccepted:false}));
  expect(defects,'OL_GALLERY_VISIBLE_REACHABLE_SINGLE_BATCH_IDENTITY').toEqual([]);
 });
},25000);
