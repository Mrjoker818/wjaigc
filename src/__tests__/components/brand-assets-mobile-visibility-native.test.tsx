// @vitest-environment node
// Default native regression for the real brand panel; synthetic assets and HTTP only.
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
const SHOTS=path.resolve('output/playwright/brand-assets-mobile-visibility-native',String(process.pid));
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
// Nonempty read-only UI: no asset row/default/delete activation.
const OG_ASSETS=[
 {id:'og-long',user_id:'default',name:'离线品牌方案－移动端长名称与中英文混排ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',brand_name:'离线品牌一',brand_colors:['#d4af37','#2563eb'],style_extra:'合成风格一',scene_desc:'合成场景一',reference_image_url:'',product_image_url:'',product_desc:'用于检查窄屏省略显示的离线产品描述一',main_text:'离线主标题一',secondary_text:'离线副标题一',accent_symbol:'圆形',selected_model:'offline-image::image0',is_default:false,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z'},
 {id:'og-second',user_id:'default',name:'离线品牌方案二－仅浏览不应用',brand_name:'离线品牌二',brand_colors:['#22c55e'],style_extra:'合成风格二',scene_desc:'合成场景二',reference_image_url:'',product_image_url:'',product_desc:'用于检查第二条方案仍然可达的离线产品描述二',main_text:'离线主标题二',secondary_text:'离线副标题二',accent_symbol:'方形',selected_model:'offline-image::image0',is_default:false,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z'}
];
for(const theme of ['gold','mono'] as const)it('OG '+theme+' 320x640 nonempty saved plans expose actions before hover and cancel without applying',async():Promise<void>=>{
 await withSession(theme,async s=>{
  const baseline=await s.page.evaluate(()=>window.ndFixture.snapshot());
  const device=await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer: coarse)').matches,hover:matchMedia('(hover: hover)').matches}));
  expect(device.width).toBe(320);expect(device.height).toBe(640);expect(device.touch).toBeGreaterThan(0);expect(device.coarse).toBe(true);expect(device.hover).toBe(false);
  await tap(s.page.getByRole('button',{name:/品牌方案/}));
  const popup=s.page.getByRole('dialog',{name:'已保存的品牌方案',exact:true});await popup.waitFor();
  expect((await geometry(popup)).fullyVisible,'OG_NONEMPTY_POPUP_REACHABLE').toBe(true);
  expect(await popup.getByTitle('删除方案',{exact:true}).count()).toBe(2);expect(await popup.getByTitle('设为默认',{exact:true}).count()).toBe(2);
  const observations:Array<{name:string;whiteSpace:string;rowVisible:boolean;defaultAction:{opacity:number;width:number;height:number;visible:boolean};deleteAction:{opacity:number;width:number;height:number;visible:boolean}}>=[];
  for(let i=0;i<2;i++){
   const name=popup.getByText(OG_ASSETS[i].name,{exact:true});expect(await name.count()).toBe(1);
   const rowVisible=(await geometry(name)).fullyVisible,whiteSpace=await name.evaluate(e=>getComputedStyle(e).whiteSpace);
   const read=async(control:Locator):Promise<{opacity:number;width:number;height:number;visible:boolean}>=>{const g=await geometry(control),value=await control.evaluate(e=>{const r=e.getBoundingClientRect();return{opacity:Number(getComputedStyle(e).opacity),width:r.width,height:r.height};});return{...value,visible:g.fullyVisible};};
   observations.push({name:OG_ASSETS[i].name,whiteSpace,rowVisible,defaultAction:await read(popup.getByTitle('设为默认',{exact:true}).nth(i)),deleteAction:await read(popup.getByTitle('删除方案',{exact:true}).nth(i))});
  }
  const first=path.join(SHOTS,theme+'-nonempty-before-hover.png');await s.page.screenshot({path:first});console.log('OG_CAPTURE '+JSON.stringify({theme,phase:'before-hover',path:first}));
  console.log('OG_NONEMPTY_OBSERVATION '+JSON.stringify({theme,device,observations,noAssetRowInput:true,noDefaultOrDeleteInput:true}));
  for(const row of observations){expect(row.rowVisible).toBe(true);expect(row.whiteSpace).toBe('nowrap');for(const action of [row.defaultAction,row.deleteAction]){expect(action.width).toBeGreaterThanOrEqual(44);expect(action.height).toBeGreaterThanOrEqual(44);expect(action.visible).toBe(true);}}
  await tap(popup.getByRole('button',{name:'保存当前',exact:true}));
  const input=s.page.getByPlaceholder('输入方案名称，如：品牌A主视觉',{exact:true});await input.waitFor();await tap(input);expect(await input.evaluate(e=>document.activeElement===e)).toBe(true);
  await s.page.keyboard.type('离线非空方案－取消不保存');expect(await input.inputValue()).toBe('离线非空方案－取消不保存');
  await tap(s.page.getByRole('button',{name:'取消',exact:true}));expect(await input.count()).toBe(0);
  expect(await s.page.evaluate(()=>window.ndFixture.snapshot())).toEqual(baseline);
  await tap(s.page.getByRole('button',{name:/品牌方案/}));await popup.waitFor();expect(await popup.getByTitle('删除方案',{exact:true}).count()).toBe(2);
  for(const asset of OG_ASSETS)expect(await popup.getByText(asset.name,{exact:true}).count()).toBe(1);
  const second=path.join(SHOTS,theme+'-nonempty-after-cancel.png');await s.page.screenshot({path:second});console.log('OG_CAPTURE '+JSON.stringify({theme,phase:'after-cancel',path:second}));
  await s.page.keyboard.press('Escape');expect(await popup.count()).toBe(0);
  await tap(s.page.getByRole('button',{name:'关闭品牌电商',exact:true}));const final=await s.page.evaluate(()=>window.ndFixture.snapshot());
  expect(final).toEqual({...baseline,closes:1});await drain(s);
  expect(s.requests.map(q=>q.method+' '+new URL(q.url).pathname+new URL(q.url).search).sort()).toEqual(['GET /','GET /api/brand-assets?userId=default','GET /api/models?type=chat','GET /api/models?type=image','POST /api/brand-ecommerce'].sort());
  expect(s.requests.filter(q=>q.method==='POST').map(q=>q.body)).toEqual(['{"action":"templates"}']);
  console.log('OG_UI_OBSERVATIONS '+JSON.stringify({theme,nonemptyRows:2,cancelPreservedList:true,selectionUnchanged:true,noAssetRowInput:true,noDefaultOrDeleteInput:true,noAssetWrites:true,physicalAndroid:false,wholeToolAccepted:false}));
  for(const row of observations){expect(row.defaultAction.opacity,'OG_DEFAULT_ACTION_VISIBLE_OUTSIDE_HOVER').toBeGreaterThanOrEqual(.99);expect(row.deleteAction.opacity,'OG_DELETE_ACTION_VISIBLE_OUTSIDE_HOVER').toBeGreaterThanOrEqual(.99);}
 });
},25000);





// Retain qualified Save contrast coverage in the default native regression.
const PO_CASES=[{theme:'gold'},{theme:'mono'}] as const;
const PO_NAMES=PO_CASES.map(({theme})=>'PO '+theme+' 320x640 active save uses actual font and rendered contrast');
interface QuickModeContrastSample { foreground:string; background:string; opacity:number; iconStroke:string; visibleText:[number,number,number]; visibleBackground:[number,number,number]; textContrast:number; iconContrast:number }
async function quickModeContrast(button:Locator):Promise<QuickModeContrastSample>{
 return button.evaluate(element=>{
     const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('OMP_FIXTURE_CONTRAST_CANVAS');
     type Rgba=[number,number,number,number];type Rgb=[number,number,number];
     const rgba=(value:string):Rgba=>{if(!CSS.supports('color',value)||/^(?:none|currentcolor|inherit|initial|unset|revert|url\()/i.test(value))throw Error('OMP_FIXTURE_CONTRAST_COLOR_NOT_PAINTABLE');ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;return[d[0],d[1],d[2],d[3]/255];};
     const blend=(front:Rgba,back:Rgb):Rgb=>[0,1,2].map(i=>front[i]*front[3]+back[i]*(1-front[3])) as Rgb;
     const luminance=(rgb:Rgb):number=>rgb.map(v=>{const n=v/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
     const contrast=(a:Rgb,b:Rgb):number=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
     if(contrast([255,255,255],[255,255,255])!==1||Math.abs(contrast([0,0,0],[255,255,255])-21)>0.000001)throw Error('OMP_FIXTURE_CONTRAST_CANARY');
     const layers:Rgba[]=[];let opaque=false;
     for(let p=element.parentElement;p;p=p.parentElement){const st=getComputedStyle(p);if(Number(st.opacity)!==1||st.filter!=='none'||st.mixBlendMode!=='normal'||st.backgroundImage!=='none')throw Error('OMP_FIXTURE_CONTRAST_UNSUPPORTED_COMPOSITE');const color=rgba(st.backgroundColor);layers.push(color);if(color[3]===1){opaque=true;break;}}
     if(!opaque)throw Error('OMP_FIXTURE_CONTRAST_BACKDROP_REQUIRED');let backdrop:Rgb=[255,255,255];for(const layer of layers.reverse())backdrop=blend(layer,backdrop);
     const style=getComputedStyle(element),opacity=Number(style.opacity),background=blend(rgba(style.backgroundColor),backdrop);
     if(style.filter!=='none'||style.mixBlendMode!=='normal'||style.backgroundImage!=='none')throw Error('OMP_FIXTURE_CONTRAST_UNSUPPORTED_CONTROL');
     const visibleBackground=blend([...background,opacity],backdrop),visibleText=blend([...blend(rgba(style.color),background),opacity],backdrop);
     const svg=element.querySelector('svg');if(!svg)throw Error('OMP_FIXTURE_CONTRAST_ICON_REQUIRED');const icon=getComputedStyle(svg);
     const strokeOpacity=Number(icon.strokeOpacity),iconOpacity=Number(icon.opacity);if(!Number.isFinite(strokeOpacity)||strokeOpacity<0||strokeOpacity>1||!Number.isFinite(iconOpacity)||iconOpacity<0||iconOpacity>1)throw Error('OMP_FIXTURE_CONTRAST_ICON_OPACITY');
     const stroke=rgba(icon.stroke);stroke[3]*=strokeOpacity*iconOpacity;const visibleIcon=blend([...blend(stroke,background),opacity],backdrop);
     return{foreground:style.color,background:style.backgroundColor,opacity,iconStroke:icon.stroke,visibleText,visibleBackground,textContrast:contrast(visibleText,visibleBackground),iconContrast:contrast(visibleIcon,visibleBackground)};
    });
}

interface SaveStyleMetadata{
 text:string;disabled:boolean;fontSize:string;fontWeight:string;size:number;weight:number;viewportScale:number;color:string;background:string;textShadow:string;textFill:string;
 iconPaint:Array<{tag:string;stroke:string;strokeOpacity:string;opacity:string;fill:string}>;
 unsupported:string[];effectiveOpacity:number;ancestors:Array<{tag:string;opacity:string;filter:string;backdrop:string;blend:string;transform:string;scale:string;rotate:string;translate:string;zoom:string}>;
}
async function saveStyleMetadata(button:Locator):Promise<SaveStyleMetadata>{
 return button.evaluate(element=>{
  if(!(element instanceof HTMLButtonElement))throw Error('PO_BUTTON_REQUIRED');
  const style=getComputedStyle(element),unsupported:string[]=[],ancestors:SaveStyleMetadata['ancestors']=[];
  let effectiveOpacity=1;
  for(let node:Element|null=element;node;node=node.parentElement){
   const s=getComputedStyle(node),opacity=Number(s.opacity),backdrop=s.backdropFilter,zoom=s.zoom;
   ancestors.push({tag:node.tagName,opacity:s.opacity,filter:s.filter,backdrop,blend:s.mixBlendMode,transform:s.transform,scale:s.scale,rotate:s.rotate,translate:s.translate,zoom});
   if(s.scale!=='none'||s.rotate!=='none'||s.translate!=='none')unsupported.push(node.tagName+':independent-transform');
   if(!Number.isFinite(opacity)||opacity!==1)unsupported.push(node.tagName+':opacity');
   effectiveOpacity*=opacity;
   if(s.filter!=='none'||s.mixBlendMode!=='normal'||(backdrop!==''&&backdrop!=='none')||(zoom!=='1'&&zoom!=='normal'))unsupported.push(node.tagName+':composite');
   if(s.perspective!=='none')unsupported.push(node.tagName+':perspective');
   if(s.transform!=='none'){
    const m=new DOMMatrixReadOnly(s.transform);
    const fixed:Array<[keyof DOMMatrixReadOnly,number]>=[['m11',1],['m12',0],['m13',0],['m14',0],['m21',0],['m22',1],['m23',0],['m24',0],['m31',0],['m32',0],['m33',1],['m34',0],['m43',0],['m44',1]];
    if(fixed.some(([key,value])=>m[key]!==value)||!Number.isFinite(m.m41)||!Number.isFinite(m.m42))unsupported.push(node.tagName+':nontranslation');
   }
  }
  const textFill=style.getPropertyValue('-webkit-text-fill-color');
  if(style.textShadow!=='none'||textFill!==style.color)unsupported.push('text-paint');
  const svgs=element.querySelectorAll('svg');
  if(svgs.length!==1||[...element.children].some(child=>child!==svgs[0]))unsupported.push('label-structure');
  const iconPaint:SaveStyleMetadata['iconPaint']=[];
  if(svgs.length===1){const root=getComputedStyle(svgs[0]);for(const node of [svgs[0],...svgs[0].querySelectorAll('*')]){
   const s=getComputedStyle(node);iconPaint.push({tag:node.tagName,stroke:s.stroke,strokeOpacity:s.strokeOpacity,opacity:s.opacity,fill:s.fill});
   if(s.stroke!==root.stroke||s.strokeOpacity!==root.strokeOpacity||Number(s.opacity)!==1||s.fill!=='none'||s.filter!=='none'||s.mixBlendMode!=='normal')unsupported.push('icon-paint:'+node.tagName);
  }}
  const size=parseFloat(style.fontSize),weight=Number(style.fontWeight),viewport=window.visualViewport;
  if(!Number.isFinite(size)||size<=0||!style.fontSize.endsWith('px')||!Number.isFinite(weight)||weight<1)unsupported.push('font');
  if(!viewport||viewport.scale!==1)unsupported.push('viewport');
  return{text:element.textContent?.trim()||'',disabled:element.disabled,fontSize:style.fontSize,fontWeight:style.fontWeight,size,weight,
   viewportScale:viewport?.scale??0,color:style.color,background:style.backgroundColor,textShadow:style.textShadow,textFill,iconPaint,unsupported,effectiveOpacity,ancestors};
 });
}
async function touch(control:Locator):Promise<void>{
 await control.scrollIntoViewIfNeeded({timeout:1500});expect((await geometry(control)).fullyVisible,'PO_TARGET_VISIBLE').toBe(true);
 expect(await control.evaluate(e=>Number(getComputedStyle(e).opacity)),'PO_TARGET_OPACITY').toBe(1);await tap(control);
}
for(const [index,{theme}]of PO_CASES.entries())it(PO_NAMES[index],async():Promise<void>=>{
 await withSession(theme,async s=>{
  const baseline=await s.page.evaluate(()=>window.ndFixture.snapshot());
  const device=await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer: coarse)').matches,hover:matchMedia('(hover: hover)').matches}));
  expect(device).toMatchObject({width:320,height:640,coarse:true,hover:false});expect(device.touch).toBeGreaterThan(0);
  await touch(s.page.getByRole('button',{name:/品牌方案/}));await touch(s.page.getByRole('button',{name:'保存当前',exact:true}));
  const input=s.page.getByPlaceholder('输入方案名称，如：品牌A主视觉',{exact:true});
  await touch(input);expect(await input.evaluate(e=>document.activeElement===e),'PO_NATIVE_TOUCH_FOCUS').toBe(true);
  await bounded(()=>input.pressSequentially('PO contrast only',{timeout:1500}),2000,'native-text');
  expect(await input.inputValue()).toBe('PO contrast only');
  const save=s.page.getByRole('button',{name:'保存',exact:true});expect(await save.isEnabled()).toBe(true);
  expect((await geometry(save)).fullyVisible).toBe(true);const rect=await save.boundingBox();expect(rect!.width).toBeGreaterThanOrEqual(44);expect(rect!.height).toBeGreaterThanOrEqual(44);
  const metadata=await saveStyleMetadata(save);console.log('PO_STYLE_METADATA '+JSON.stringify({theme,metadata}));
  if(metadata.unsupported.length)throw Error('PO_STYLE_UNSUPPORTED:'+JSON.stringify(metadata.unsupported));
  expect(metadata.disabled).toBe(false);expect(metadata.text).toBe('保存');expect(metadata.effectiveOpacity).toBe(1);
  const hovered=await save.evaluate(e=>e.matches(':hover'));expect(hovered).toBe(false);
  const colors=await quickModeContrast(save),large=metadata.size>=24||(metadata.size>=14*96/72&&metadata.weight>=700),minimum=large?3:4.5;
  expect(colors.foreground).toBe(metadata.color);expect(colors.background).toBe(metadata.background);
  expect(await saveStyleMetadata(save),'PO_STYLE_SAME_STATE').toEqual(metadata);
  const file=path.join(SHOTS,theme+'-active-save.png');await bounded(()=>s.page.screenshot({path:file}),3000,'capture');
  console.log('PO_CAPTURE '+JSON.stringify({theme,path:file}));
  await touch(s.page.getByRole('button',{name:'取消',exact:true}));expect(await input.count()).toBe(0);
  await touch(s.page.getByRole('button',{name:'关闭品牌电商',exact:true}));
  const final=await s.page.evaluate(()=>window.ndFixture.snapshot());expect(final).toEqual({...baseline,closes:1});await drain(s);
  expect(s.requests.map(q=>q.method+' '+new URL(q.url).pathname+new URL(q.url).search).sort()).toEqual(
   ['GET /','GET /api/brand-assets?userId=default','GET /api/models?type=image','GET /api/models?type=chat','POST /api/brand-ecommerce'].sort());
  console.log('PO_CONTRAST_OBSERVATION '+JSON.stringify({theme,device,metadata,hovered,colors,large,minimum,final,bodyComplete:true,
   noSaveSubmission:true,noAssetWrites:true,noGeneration:true,noUpload:true,nativeScrollAccepted:false,physicalAndroidAccepted:false}));
  expect(colors.iconContrast,'PO_SAVE_ICON_CONTRAST').toBeGreaterThanOrEqual(3);
  expect(colors.textContrast,'PO_SAVE_LABEL_CONTRAST').toBeGreaterThanOrEqual(minimum);
 });
},25000);
