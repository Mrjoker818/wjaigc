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
const SHOTS=path.resolve('output/playwright/brand-settings-populated-mobile-native',String(process.pid));
const ENTRY=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrandEcommercePanel} from '@/components/brand-ecommerce-panel';
const root=createRoot(document.getElementById('fixture-root')!);
const state={closes:0,adds:0,errors:[] as string[],mounted:false};
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:Error){state.errors.push(e.message);}
 render(){return this.state.failed?null:this.props.children;}
}
const selection=JSON.stringify({model:'image0',providerId:'offline-image'});
Object.assign(window,{ndFixture:{state,
 mount(theme:string){if(state.mounted)throw Error('ND_REMOUNT');state.mounted=true;
  document.documentElement.classList.toggle('dark',theme==='gold');
  document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
  localStorage.setItem('wujie_selected_model',selection);
  root.render(<Boundary><BrandEcommercePanel isMonochrome={theme==='mono'} onClose={()=>{state.closes++;root.render(null);}}
   onAddImages={()=>{state.adds++;}} /></Boundary>);},
 unmount(){root.unmount();},
 snapshot(){return {...state,selection:localStorage.getItem('wujie_selected_model')};}
}});
`;
interface Snapshot{closes:number;adds:number;errors:string[];mounted:boolean;selection:string|null}
declare global{interface Window{ndFixture:{mount:(theme:string)=>void;unmount:()=>void;snapshot:()=>Snapshot}}}
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
 if(u.origin!==ORIGIN||u.username||u.password||h.authorization||h.cookie||h['x-api-key']||h['api-key']||h['idempotency-key'])throw Error('ND_HTTP_BOUNDARY');
 const key=u.pathname+u.search;
 if(method==='GET'&&body===null){
  if(key==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'</style></head><body><div id="fixture-root"></div></body></html>'});return;}
  if(key==='/api/brand-assets?userId=default'){await route.fulfill({json:{success:true,assets:OG_ASSETS}});return;}
  if(key==='/api/models?type=image'){await route.fulfill({json:{models:[{id:'image0',name:'离线图像模型',providerId:'offline-image'}],providers:[{id:'offline-image',name:'离线图像供应商',baseUrl:'https://provider.invalid',apiKeyPreview:''}]}});return;}
  if(key==='/api/models?type=chat'){await route.fulfill({json:{models:[{id:'chat0',name:'离线视觉模型',providerId:'offline-chat'}],providers:[{id:'offline-chat',name:'离线视觉供应商',baseUrl:'https://provider.invalid',apiKeyPreview:''}]}});return;}
 }
 if(method==='POST'&&key==='/api/brand-ecommerce'&&body==='{"action":"templates"}'){
  await route.fulfill({json:{success:true,templates:[template('white-bg','离线白底主图'),template('scene-lifestyle','离线场景图')]}});return;
 }
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
  await page.goto(ORIGIN+'/');await page.addScriptTag({content:bundle});s.mounted=true;await page.evaluate(t=>window.ndFixture.mount(t),theme);
  await page.getByText('离线白底主图',{exact:true}).waitFor();await drain(s);return s;
 }catch(e){try{await dispose(s);}catch(c){throw new AggregateError([e,c],'ND_BOOTSTRAP_AND_CLEANUP');}throw e;}
}
async function dispose(s:Session):Promise<void>{
 const errors:string[]=[];try{if(s.mounted&&!s.page.isClosed()){await bounded(()=>s.page.evaluate(()=>window.ndFixture.unmount()),3000,'unmount');s.mounted=false;}await bounded(()=>Promise.all([...s.handlers]),3000,'routes');await drain(s);
  const state=await s.page.evaluate(()=>window.ndFixture.snapshot());errors.push(...state.errors);if(s.pending.size)errors.push('PENDING');
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
// A complete synthetic saved asset populates the real parent form; application is local only.
const OJ_IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4st78PwgzwBgAYgQK5f/y4U4AAAAASUVORK5CYII=';
const OG_ASSETS=[{id:'oj-local',user_id:'default',name:'离线非空品牌设置',brand_name:'离线品牌',brand_colors:['#d4af37','#2563eb'],style_extra:'合成风格',scene_desc:'合成场景',reference_image_url:OJ_IMAGE,product_image_url:OJ_IMAGE,product_desc:'合成产品描述',main_text:'合成主标题',secondary_text:'合成副标题',accent_symbol:'圆形',selected_model:'offline-image::image0',is_default:false,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z'}];
interface OjControl{id:string;opacity:number;ancestors:Array<{tag:string;opacity:number}>;width:number;height:number;visible:boolean;accessibleName:string}
async function readControl(control:Locator,id:string):Promise<OjControl>{
 await control.scrollIntoViewIfNeeded({timeout:1500});
 const shape=await geometry(control);
 const values=await control.evaluate(element=>{const r=element.getBoundingClientRect(),ancestors:Array<{tag:string;opacity:number}>=[];let opacity=1;
  for(let node:Element|null=element;node;node=node.parentElement){const alpha=Number(getComputedStyle(node).opacity);opacity*=alpha;if(alpha<1)ancestors.push({tag:node.tagName,opacity:alpha});}
  return{opacity,ancestors,width:r.width,height:r.height,accessibleName:element.getAttribute('aria-label')||element.textContent?.trim()||''};});
 return {id,...values,visible:shape.fullyVisible};
}
for(const theme of ['gold','mono'] as const)it('OJ '+theme+' 320x640 populated settings expose and operate color reference and product actions without hover',async():Promise<void>=>{
 await withSession(theme,async s=>{
  const baseline=await s.page.evaluate(()=>window.ndFixture.snapshot());
  const device=await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer: coarse)').matches,hover:matchMedia('(hover: hover)').matches}));
  expect(device).toMatchObject({width:320,height:640,coarse:true,hover:false});expect(device.touch).toBeGreaterThan(0);
  await tap(s.page.getByRole('button',{name:/品牌方案/}));
  await tap(s.page.getByText('离线非空品牌设置',{exact:true}).locator('../..'));
  await s.page.getByPlaceholder('描述你的商品，如：高端无线降噪耳机，磨砂黑色，金属质感...',{exact:true}).waitFor();
  const ref=s.page.getByAltText('参考图',{exact:true}),product=s.page.getByAltText('产品图',{exact:true});
  for(const image of [ref,product]){expect(await image.getAttribute('src')).toBe(OJ_IMAGE);expect(await image.evaluate(e=>({complete:(e as HTMLImageElement).complete,width:(e as HTMLImageElement).naturalWidth}))).toEqual({complete:true,width:2});}
  const color=s.page.getByText('#d4af37',{exact:true}).locator('..').getByRole('button');
  const reference=ref.locator('..'),productBox=product.locator('..');
  const refReplace=reference.getByRole('button',{name:'更换',exact:true}),refRemove=reference.getByRole('button',{name:'移除',exact:true});
  const productReplace=productBox.getByRole('button',{name:'更换',exact:true}),productRemove=productBox.getByRole('button',{name:'删除',exact:true});
  const observations:OjControl[]=[];
  for(const [control,id] of [[color,'color-remove'],[refReplace,'reference-replace'],[refRemove,'reference-remove'],[productReplace,'product-replace'],[productRemove,'product-remove']] as const){observations.push(await readControl(control,id));}
  const before=path.join(SHOTS,theme+'-populated-before-actions.png');await s.page.screenshot({path:before});console.log('OJ_CAPTURE '+JSON.stringify({theme,phase:'before-actions',path:before}));
  // Positioning is programmatic; subsequent taps are native. This does not claim native scrolling.
  for(const control of [refReplace,productReplace]){
   await control.scrollIntoViewIfNeeded({timeout:1500});
   const [chooser]=await bounded(()=>Promise.all([s.page.waitForEvent('filechooser',{timeout:1500}),tap(control)]),3000,'filechooser-open');
   await bounded(()=>chooser.setFiles([]),1500,'filechooser-cancel');
  }
  expect(await ref.getAttribute('src')).toBe(OJ_IMAGE);expect(await product.getAttribute('src')).toBe(OJ_IMAGE);
  await color.scrollIntoViewIfNeeded({timeout:1500});await tap(color);
  expect(await s.page.getByText('#d4af37',{exact:true}).count()).toBe(0);expect(await s.page.getByText('#2563eb',{exact:true}).count()).toBe(1);
  await refRemove.scrollIntoViewIfNeeded({timeout:1500});await tap(refRemove);
  expect(await ref.count()).toBe(0);expect(await product.count()).toBe(1);expect(await s.page.getByRole('button',{name:'上传风格参考图',exact:true}).count()).toBe(1);
  await productRemove.scrollIntoViewIfNeeded({timeout:1500});await tap(productRemove);
  expect(await product.count()).toBe(0);expect(await s.page.getByRole('button',{name:/上传产品实物图/}).count()).toBe(1);
  expect(await s.page.getByText('产品一致性',{exact:true}).count()).toBe(0);
  const after=path.join(SHOTS,theme+'-populated-after-actions.png');await s.page.screenshot({path:after});console.log('OJ_CAPTURE '+JSON.stringify({theme,phase:'after-actions',path:after}));
  await tap(s.page.getByRole('button',{name:'关闭品牌电商',exact:true}));
  expect(await s.page.evaluate(()=>window.ndFixture.snapshot())).toEqual({...baseline,closes:1});await drain(s);
  expect(s.requests.map(q=>q.method+' '+new URL(q.url).pathname+new URL(q.url).search).sort()).toEqual(['GET /','GET /api/brand-assets?userId=default','GET /api/models?type=chat','GET /api/models?type=image','POST /api/brand-ecommerce'].sort());
  expect(s.requests.filter(q=>q.method==='POST').map(q=>q.body)).toEqual(['{"action":"templates"}']);
  console.log('OJ_POPULATED_OBSERVATION '+JSON.stringify({theme,device,observations,appliedSyntheticLocalDraft:true,fileChooserCancelled:2,colorRemovedOnce:true,otherColorPreserved:true,referenceRemoved:true,productRemoved:true,selectionPreserved:true,noAssetWrites:true,noUpload:true,noGeneration:true,nativeScrollAccepted:false,physicalAndroidAccepted:false}));
  const defects=observations.flatMap(o=>[...(o.opacity<.99?[o.id+':opacity='+o.opacity]:[]),...(o.width<44||o.height<44?[o.id+':target='+o.width+'x'+o.height]:[]),...(!o.visible?[o.id+':clipped']:[])]);
  expect(defects,'OJ_POPULATED_ACTIONS_VISIBLE_AND_REACHABLE').toEqual([]);
 });
},25000);
