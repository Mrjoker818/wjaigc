// @vitest-environment node
// Real bottom-docked LayerPanel, wide coarse/no-hover controls; in-page synthetic state only.
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

const ORIGIN='https://layer-wide-touch.invalid';
const SHOTS=path.resolve('output/playwright/layer-panel-wide-touch-native',String(process.pid));
const ENTRY=String.raw`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LayerPanel} from '@/components/layer-panel';
import type {CanvasImage} from '@/components/infinite-canvas';
const root=createRoot(document.getElementById('fixture-root')!);
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4st78PwgzwBgAYgQK5f/y4U4AAAAASUVORK5CYII=';
const initial:CanvasImage[]=[
 {id:'on-alpha',url:png,name:'触控图层 Alpha',x:10,y:20,width:64,height:64,zIndex:30,visible:true,locked:false,modelName:'离线模型 Alpha',apiProviderId:'offline-provider',assetId:'offline-asset-alpha'},
 {id:'on-beta',url:png,name:'触控图层 Beta',x:90,y:20,width:64,height:64,zIndex:20,visible:true,locked:false,modelName:'离线模型 Beta',apiProviderId:'offline-provider',assetId:'offline-asset-beta'},
 {id:'on-gamma',url:png,name:'触控图层 Gamma',x:170,y:20,width:64,height:64,zIndex:10,visible:true,locked:false,modelName:'离线模型 Gamma',apiProviderId:'offline-provider',assetId:'offline-asset-gamma'},
];
type Action={action:string;id:string;value?:boolean|string};
const state={images:initial,selected:[] as string[],actions:[] as Action[],errors:[] as string[],closes:0,mounted:false,inset:0};
let changeInset:React.Dispatch<React.SetStateAction<number>>|undefined;
class Boundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(e:Error){state.errors.push(e.message);}
 render(){return this.state.failed?null:this.props.children;}
}
function Entry({theme}:{theme:string}):React.ReactElement{
 const [images,setImages]=useState(initial),[selected,setSelected]=useState<string[]>([]),[inset,setInset]=useState(0),[open,setOpen]=useState(true);
 changeInset=setInset;state.images=images;state.selected=selected;state.inset=inset;
 return <>{open&&<LayerPanel floating={false} position="bottom" rightInset={inset} width={320} images={images} selectedIds={selected} isMonochrome={theme==='mono'}
 onSelect={ids=>{state.actions.push({action:'select',id:ids.join(',')});setSelected(ids);}}
 onToggleVisibility={id=>setImages(current=>current.map(image=>{if(image.id!==id)return image;const visible=image.visible===false;state.actions.push({action:'visible',id,value:visible});return {...image,visible};}))}
 onToggleLock={id=>setImages(current=>current.map(image=>{if(image.id!==id)return image;const locked=!image.locked;state.actions.push({action:'locked',id,value:locked});return {...image,locked};}))}
 onRename={(id,name)=>{state.actions.push({action:'rename',id,value:name});setImages(current=>current.map(image=>image.id===id?{...image,name}:image));}}
 onClose={()=>{state.closes++;setOpen(false);}}
 onDelete={()=>{throw Error('ON_DELETE_FORBIDDEN');}} onReorder={()=>{throw Error('ON_REORDER_FORBIDDEN');}}
 onSetAllVisibility={()=>{throw Error('ON_BULK_VISIBILITY_FORBIDDEN');}} onSetAllLocked={()=>{throw Error('ON_BULK_LOCK_FORBIDDEN');}}
 onCreateGroup={()=>{throw Error('ON_CREATE_GROUP_FORBIDDEN');}}/>}</>;
}
Object.assign(window,{onFixture:{state,mount(theme:string){if(state.mounted)throw Error('ON_REMOUNT');state.mounted=true;
 document.documentElement.classList.toggle('dark',theme==='gold');document.documentElement.classList.toggle('theme-monochrome',theme==='mono');
 root.render(<Boundary><Entry theme={theme}/></Boundary>);},
 setInset(inset:number){if(!changeInset)throw Error('ON_NO_ENTRY');changeInset(inset);},
 unmount(){root.unmount();},snapshot(){return structuredClone(state);}
}});
`;
interface OnImage{id:string;name:string;visible:boolean;locked:boolean;assetId:string;apiProviderId:string}
interface Snapshot{images:OnImage[];selected:string[];actions:Array<{action:string;id:string;value?:boolean|string}>;errors:string[];closes:number;mounted:boolean;inset:number}
declare global{interface Window{onFixture:{mount:(theme:string)=>void;setInset:(inset:number)=>void;unmount:()=>void;snapshot:()=>Snapshot}}}
interface Session{context:BrowserContext;page:Page;mounted:boolean;handlers:Set<Promise<void>>;pending:Set<Request>;faults:string[];requests:Array<{url:string;method:string;body:string|null}>}
let browser:Browser|undefined,bundle='',css='';const live=new Set<Session>();
const operations=createOwnedOperations(),contexts=new Set<BrowserContext>(),browsers=new Set<Browser>(),contextClosing=new Map<BrowserContext,Promise<void>>(),browserClosing=new Map<Browser,Promise<void>>();let closing=false;
function closeContext(context:BrowserContext):Promise<void>{let promise=contextClosing.get(context);if(!promise){promise=context.close();contextClosing.set(context,promise);}return promise;}
function closeBrowser(value:Browser):Promise<void>{let promise=browserClosing.get(value);if(!promise){promise=value.close();browserClosing.set(value,promise);}return promise;}
async function bounded<T>(operation:()=>Promise<T>,ms:number,label:string):Promise<T>{return operations.run('ND-'+label,operation,ms);}
beforeAll(async():Promise<void>=>{
 const setupStarted=performance.now();
 await operations.run('ND-bundle-and-CSS',async()=>{
 if(fs.existsSync(SHOTS))throw Error('ND_OLD_SCREENSHOTS');fs.mkdirSync(SHOTS,{recursive:true});
 const require=createRequire(import.meta.url),files=['src/components/layer-panel.tsx','src/hooks/use-mobile.ts'];
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
 const q=route.request(),u=new URL(q.url()),method=q.method(),body=q.postData(),h=q.headers();s.requests.push({url:q.url(),method,body});
 if(u.href!==ORIGIN+'/'||u.username||u.password||method!=='GET'||body!==null||!q.isNavigationRequest()||['authorization','cookie','x-api-key','api-key','idempotency-key'].some(key=>key in h)||s.requests.length!==1)throw Error('ON_EXACT_ONE_DOCUMENT_NO_CREDENTIALS');
 await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>'+css+'</style></head><body style="margin:0;width:100vw;height:100dvh;overflow:hidden"><div id="fixture-root"></div></body></html>'});
}
async function drain(s:Session):Promise<void>{const end=Date.now()+1500;while((s.handlers.size||s.pending.size)&&Date.now()<end)await new Promise<void>(resolve=>setTimeout(resolve,10));if(s.handlers.size||s.pending.size)throw Error('ND_NETWORK_NOT_DRAINED');}
async function open(theme:string,width:number,height:number,desktop=false):Promise<Session>{
 if(!browser||closing)throw Error('ND_NO_BROWSER');const owner={ended:false};
 const context:BrowserContext=await acquireOwned(operations,'ND-context-create',async()=>{const value=await browser!.newContext({serviceWorkers:'block',viewport:{width,height},hasTouch:!desktop,isMobile:!desktop});contexts.add(value);value.once('close',()=>contexts.delete(value));return value;},closeContext,()=>closing||owner.ended).catch(e=>{owner.ended=true;throw e;});
 let page:Page;try{page=await acquireOwned(operations,'ND-page-create',()=>context.newPage(),(value:Page)=>value.close(),()=>closing||owner.ended);}catch(e){owner.ended=true;await bounded(()=>closeContext(context),5000,'bootstrap-close');throw e;}
 page.setDefaultTimeout(1500);const s:Session={context,page,mounted:false,handlers:new Set(),pending:new Set(),faults:[],requests:[]};live.add(s);
 page.on('pageerror',e=>s.faults.push('PAGE:'+e.message));page.on('console',m=>{if(m.type()==='error')s.faults.push('CONSOLE:'+m.text());});
 page.on('dialog',d=>{s.faults.push('DIALOG');void d.dismiss();});page.on('request',q=>s.pending.add(q));page.on('requestfinished',q=>s.pending.delete(q));page.on('requestfailed',q=>{s.pending.delete(q);s.faults.push('REQUEST_FAILED:'+q.url());});
 page.on('response',r=>{if(r.status()>=400)s.faults.push('HTTP_STATUS:'+r.status());});
 try{
  await context.routeWebSocket('**/*',socket=>{s.faults.push('WEBSOCKET');socket.close({code:1008,reason:'offline-only'});});
  await context.route('**/*',async route=>{const task=routeRequest(s,route);s.handlers.add(task);try{await task;}catch(e){s.faults.push(String(e));try{await route.abort('blockedbyclient');}catch(a){s.faults.push(String(a));}}finally{s.handlers.delete(task);}});
  await page.goto(ORIGIN+'/');await page.addScriptTag({content:bundle});s.mounted=true;await page.evaluate(t=>window.onFixture.mount(t),theme);
  await page.locator('[data-popup="layer-panel"]').waitFor();await drain(s);return s;
 }catch(e){try{await dispose(s);}catch(c){throw new AggregateError([e,c],'ND_BOOTSTRAP_AND_CLEANUP');}throw e;}
}
async function dispose(s:Session):Promise<void>{
 const errors:string[]=[];try{if(s.mounted&&!s.page.isClosed()){await bounded(()=>s.page.evaluate(()=>window.onFixture.unmount()),3000,'unmount');s.mounted=false;}await bounded(()=>Promise.all([...s.handlers]),3000,'routes');await drain(s);
  const state=await s.page.evaluate(()=>window.onFixture.snapshot());errors.push(...state.errors);if(s.pending.size)errors.push('PENDING');
 }catch(e){errors.push(String(e));}finally{try{await bounded(()=>closeContext(s.context),5000,'context-close');}catch(e){errors.push(String(e));}live.delete(s);}
 if(errors.length||s.faults.length)throw Error('ND_INFRASTRUCTURE_ERROR:'+JSON.stringify({errors,faults:s.faults}));
}
async function withSession(theme:string,width:number,height:number,body:(s:Session)=>Promise<void>,desktop=false):Promise<void>{const s=await open(theme,width,height,desktop);let failed=false,cause:unknown,cleanupFailed=false,cleanup:unknown;try{await body(s);}catch(e){failed=true;cause=e;}try{await dispose(s);}catch(e){cleanupFailed=true;cleanup=e;}if(cleanupFailed)throw new AggregateError(failed?[cause,cleanup]:[cleanup],'ND_BODY_AND_CLEANUP');if(failed)throw cause;}
async function geometry(locator:Locator):Promise<{fullyVisible:boolean;rect:{left:number;right:number;top:number;bottom:number};visible:{left:number;right:number;top:number;bottom:number};hits:boolean[]}>{
 return locator.evaluate(element=>{const r=element.getBoundingClientRect(),rect={left:r.left,right:r.right,top:r.top,bottom:r.bottom},visible={left:0,right:innerWidth,top:0,bottom:innerHeight};
  for(let parent=element.parentElement;parent;parent=parent.parentElement){const c=getComputedStyle(parent),p=parent.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(c.overflowX)){visible.left=Math.max(visible.left,p.left+parent.clientLeft);visible.right=Math.min(visible.right,p.left+parent.clientLeft+parent.clientWidth);}if(/hidden|clip|scroll|auto/.test(c.overflowY)){visible.top=Math.max(visible.top,p.top+parent.clientTop);visible.bottom=Math.min(visible.bottom,p.top+parent.clientTop+parent.clientHeight);}}
  const hits=[r.left+7,(r.left+r.right)/2,r.right-7].flatMap(x=>[r.top+7,(r.top+r.bottom)/2,r.bottom-7].map(y=>{const hit=document.elementFromPoint(x,y);return Boolean(hit&&(hit===element||element.contains(hit)));}));
  return {rect,visible,hits,fullyVisible:r.width>0&&r.height>0&&r.left>=visible.left-1&&r.right<=visible.right+1&&r.top>=visible.top-1&&r.bottom<=visible.bottom+1&&hits.every(Boolean)};
 });
}

interface ActionShape{id:string;opacity:number;width:number;height:number;visible:boolean;display:string;fontSize:string}
async function settle(page:Page):Promise<void>{await page.evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});}
async function shape(control:Locator,id:string):Promise<ActionShape>{
 expect(await control.count(),'ON_EXPECTED_SINGLE_CONTROL '+id).toBe(1);
 const rendered=await control.evaluate(el=>{if(!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement)if(getComputedStyle(p).display==='none')return false;return true;});
 if(!rendered)return {id,visible:false,...await control.evaluate(el=>{const rect=el.getBoundingClientRect();let opacity=1,display=getComputedStyle(el).display;for(let p:Element|null=el;p;p=p.parentElement){const c=getComputedStyle(p);opacity*=Number(c.opacity);if(c.display==='none')display='none';}return {opacity,width:rect.width,height:rect.height,display,fontSize:getComputedStyle(el).fontSize};})};
 await control.scrollIntoViewIfNeeded({timeout:1500});const clipped=await geometry(control);
 return {id,visible:clipped.fullyVisible,...await control.evaluate(el=>{const r=el.getBoundingClientRect();let opacity=1;for(let p:Element|null=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);const c=getComputedStyle(el);return {opacity,width:r.width,height:r.height,display:c.display,fontSize:c.fontSize};})};
}
const eligible=(r:ActionShape):boolean=>r.opacity>=.99&&r.width>=44&&r.height>=44&&r.visible&&r.display!=='none';
async function touch(control:Locator):Promise<void>{const r=await shape(control,'native-input');expect(eligible(r),'ON_TOUCH_POINT_ELIGIBLE').toBe(true);await control.tap();await settle(control.page());}
const MATRIX=(['gold','mono'] as const).flatMap(theme=>[{width:844,height:390},{width:1040,height:720}].map(viewport=>({theme,...viewport})));
for(const e of MATRIX)it('ON '+e.theme+' '+e.width+'x'+e.height+' bottom layers retain visible reachable touch controls and rename',async():Promise<void>=>{
 await withSession(e.theme,e.width,e.height,async s=>{
  const device=await s.page.evaluate(()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,hover:matchMedia('(hover:hover)').matches}));
  expect(device).toMatchObject({width:e.width,height:e.height,coarse:true,hover:false});expect(device.touch).toBeGreaterThan(0);
  const panel=s.page.locator('[data-popup="layer-panel"]'),observations:Array<{inset:number;rows:ActionShape[];focusBeforeTyping:boolean[];flowCompleted:boolean;blockedAt:string|null;panel:{left:number;right:number;top:number;bottom:number;width:number;height:number};before:Snapshot;after:Snapshot}>=[];
  for(const inset of [0,480]){
   await s.page.evaluate(value=>window.onFixture.setInset(value),inset);await settle(s.page);
   const before=await s.page.evaluate(()=>window.onFixture.snapshot());expect(before.inset).toBe(inset);expect(before.images.map(image=>image.id)).toEqual(['on-alpha','on-beta','on-gamma']);
   const currentName=before.images[0].name,card=panel.getByTitle(currentName,{exact:true}),image=card.getByAltText(currentName,{exact:true});
   expect(await image.evaluate(async el=>{await(el as HTMLImageElement).decode();return(el as HTMLImageElement).naturalWidth;})).toBe(2);
   const rows:ActionShape[]=[],focusBeforeTyping:boolean[]=[];
   for(const [id,control] of [
    ['all-visible',panel.getByTitle('全部显示/隐藏',{exact:true})],['all-lock',panel.getByTitle('全部锁定/解锁',{exact:true})],['close',panel.getByTitle('关闭图层',{exact:true})],
    ['visible',card.getByTitle('隐藏图层',{exact:true})],['lock',card.getByTitle('锁定图层',{exact:true})],['more',card.getByRole('button',{name:'图层 '+currentName+' 更多操作',exact:true})],
   ] as const)rows.push(await shape(control,id));
   const placement=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
   expect(placement.left).toBe(0);expect(placement.bottom).toBe(e.height);expect(placement.width).toBe(e.width-inset);
   await s.page.screenshot({path:path.join(SHOTS,e.theme+'-'+e.width+'x'+e.height+'-inset'+inset+'.png')});console.log('ON_CAPTURE '+JSON.stringify({...e,inset,path:path.join(SHOTS,e.theme+'-'+e.width+'x'+e.height+'-inset'+inset+'.png')}));
   let flowCompleted=false,blockedAt:string|null=rows.find(r=>!eligible(r))?.id??null;
   if(!blockedAt){
    await image.scrollIntoViewIfNeeded();
    const imagePointProof=await image.evaluate((image,expectedName)=>{
     const r=image.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,card=image.parentElement?.parentElement,hit=document.elementFromPoint(x,y);
     let left=0,right=innerWidth,top=0,bottom=innerHeight,opacity=1;
     for(let parent:Element|null=image;parent;parent=parent.parentElement){const c=getComputedStyle(parent);opacity*=Number(c.opacity);if(parent===image)continue;const b=parent.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(c.overflowX)){left=Math.max(left,b.left+parent.clientLeft);right=Math.min(right,b.left+parent.clientLeft+parent.clientWidth);}if(/hidden|clip|scroll|auto/.test(c.overflowY)){top=Math.max(top,b.top+parent.clientTop);bottom=Math.min(bottom,b.top+parent.clientTop+parent.clientHeight);}}
     const rectUnclipped=r.width>0&&r.height>0&&r.left>=left-1&&r.right<=right+1&&r.top>=top-1&&r.bottom<=bottom+1,centerUnclipped=x>=Math.max(left,r.left)&&x<Math.min(right,r.right)&&y>=Math.max(top,r.top)&&y<Math.min(bottom,r.bottom);
     const imageHit=hit===image,sameCard=Boolean(card&&hit&&card.contains(hit)&&card.getAttribute('title')===expectedName),singleImageCard=card?.querySelectorAll('img').length===1,otherInteractive=Boolean(hit?.closest('button,a,input,select,textarea,[role="button"],[role="link"],[contenteditable="true"]'));
     return {x,y,width:r.width,height:r.height,rectUnclipped,centerUnclipped,imageHit,sameCard,singleImageCard,otherInteractive,opacity,acceptedForInput:rectUnclipped&&centerUnclipped&&imageHit&&sameCard&&singleImageCard&&!otherInteractive&&opacity>=.99};
    },currentName);
    console.log('OQ_IMAGE_POINT_PROOF '+JSON.stringify({...e,inset,imagePointProof}));
    expect(imagePointProof.acceptedForInput,'OQ_ACTUAL_IMAGE_TAP_POINT_VALIDATED').toBe(true);
    await image.tap();await settle(s.page);
    expect((await s.page.evaluate(()=>window.onFixture.snapshot())).selected).toEqual(['on-alpha']);
    await touch(card.getByTitle('隐藏图层',{exact:true}));expect((await s.page.evaluate(()=>window.onFixture.snapshot())).images[0].visible).toBe(false);
    // Hidden layers intentionally dim the card on wide screens. Do not mistake this product state for a newly hidden control.
    const restore=card.getByTitle('显示图层',{exact:true}),restoreShape=await shape(restore,'restore-visible');expect(restoreShape.width).toBeGreaterThanOrEqual(44);expect(restoreShape.height).toBeGreaterThanOrEqual(44);expect(restoreShape.visible).toBe(true);expect(restoreShape.opacity).toBeGreaterThan(0);await restore.tap();await settle(s.page);
    await touch(card.getByTitle('锁定图层',{exact:true}));expect((await s.page.evaluate(()=>window.onFixture.snapshot())).images[0].locked).toBe(true);
    await touch(card.getByTitle('解锁图层',{exact:true}));expect((await s.page.evaluate(()=>window.onFixture.snapshot())).images[0].locked).toBe(false);
    await touch(card.getByRole('button',{name:'图层 '+currentName+' 更多操作',exact:true}));
    for(const name of ['重命名','上移一层','下移一层','删除图层'])rows.push(await shape(panel.getByRole('button',{name,exact:true}),'menu-'+name));
    if(rows.some(r=>!eligible(r)))blockedAt=rows.find(r=>!eligible(r))!.id;
    else{
     await touch(panel.getByRole('button',{name:'重命名',exact:true}));
     const input=card.getByRole('textbox');await input.waitFor();rows.push(await shape(input,'rename-input'));
     rows.push(await shape(card.getByRole('button',{name:'取消重命名',exact:true}),'rename-cancel'));
     rows.push(await shape(card.getByRole('button',{name:'保存重命名',exact:true}),'rename-save'));
     blockedAt=rows.find(r=>!eligible(r))?.id??null;
     if(!blockedAt){
      expect(await input.inputValue()).toBe(currentName);expect(await input.evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px');
      await touch(input);const cancelFocused=await input.evaluate(el=>document.activeElement===el);focusBeforeTyping.push(cancelFocused);expect(cancelFocused,'ON_CANCEL_INPUT_FOCUSED_BEFORE_FILL').toBe(true);await input.fill('不应保存的草稿');await touch(card.getByRole('button',{name:'取消重命名',exact:true}));
      expect((await s.page.evaluate(()=>window.onFixture.snapshot())).images[0].name).toBe(currentName);
      expect((await s.page.evaluate(()=>window.onFixture.snapshot())).actions.filter(a=>a.action==='rename').length).toBe(before.actions.filter(a=>a.action==='rename').length);
      await touch(card.getByRole('button',{name:'图层 '+currentName+' 更多操作',exact:true}));
      await touch(panel.getByRole('button',{name:'重命名',exact:true}));
      await card.getByRole('textbox').fill('键盘取消的草稿');
      await s.page.keyboard.press('Tab');
      expect(await card.getByRole('button',{name:'保存重命名'}).evaluate(el=>document.activeElement===el)).toBe(true);
      await s.page.keyboard.press('Tab');
      expect(await card.getByRole('button',{name:'取消重命名'}).evaluate(el=>document.activeElement===el)).toBe(true);
      await s.page.keyboard.press('Enter');
      await card.getByRole('textbox').waitFor({state:'detached'});
      expect((await s.page.evaluate(()=>window.onFixture.snapshot())).images[0].name).toBe(currentName);
      expect((await s.page.evaluate(()=>window.onFixture.snapshot())).actions.filter(a=>a.action==='rename').length).toBe(before.actions.filter(a=>a.action==='rename').length);
      await touch(card.getByRole('button',{name:'图层 '+currentName+' 更多操作',exact:true}));await touch(panel.getByRole('button',{name:'重命名',exact:true}));
      const saveInput=card.getByRole('textbox');await touch(saveInput);const saveFocused=await saveInput.evaluate(el=>document.activeElement===el);focusBeforeTyping.push(saveFocused);expect(saveFocused,'ON_SAVE_INPUT_FOCUSED_BEFORE_FILL').toBe(true);await saveInput.fill('触控已保存 '+inset);
      await touch(card.getByRole('button',{name:'保存重命名',exact:true}));
      const after=await s.page.evaluate(()=>window.onFixture.snapshot());expect(after.images[0].name).toBe('触控已保存 '+inset);
      expect(after.actions.slice(before.actions.length)).toEqual([{action:'select',id:'on-alpha'},{action:'visible',id:'on-alpha',value:false},{action:'visible',id:'on-alpha',value:true},{action:'locked',id:'on-alpha',value:true},{action:'locked',id:'on-alpha',value:false},{action:'rename',id:'on-alpha',value:'触控已保存 '+inset}]);
      expect(after.images.slice(1)).toEqual(before.images.slice(1));expect(after.images.map(i=>[i.id,i.assetId,i.apiProviderId])).toEqual([['on-alpha','offline-asset-alpha','offline-provider'],['on-beta','offline-asset-beta','offline-provider'],['on-gamma','offline-asset-gamma','offline-provider']]);
      flowCompleted=true;
     }
    }
   }
   if(blockedAt&&await panel.getByRole('textbox').count()){await panel.getByRole('textbox').press('Escape');await settle(s.page);}
   if(blockedAt&&await panel.getByRole('button',{name:'重命名',exact:true}).count()){
    const overlay=panel.locator(':scope > .fixed.inset-0');expect(await overlay.evaluate(el=>document.elementFromPoint(4,4)===el)).toBe(true);await overlay.tap({position:{x:4,y:4}});await settle(s.page);
   }
   const after=await s.page.evaluate(()=>window.onFixture.snapshot());expect(after.errors).toEqual([]);
   observations.push({inset,rows,focusBeforeTyping,flowCompleted,blockedAt,panel:placement,before,after});
  }
  const failed=observations.filter(o=>!o.flowCompleted||o.rows.some(r=>!eligible(r))).map(o=>({inset:o.inset,blockedAt:o.blockedAt,rows:o.rows.filter(r=>!eligible(r))}));
  console.log('ON_LAYER_OBSERVATION '+JSON.stringify({...e,device,observations,failures:failed,programmaticPositioning:true,nativeScrollAccepted:false,realCanvasPersistence:false,physicalAndroidAccepted:false,noAssetWrites:true}));
  expect(failed,'ON_WIDE_TOUCH_LAYER_CONTROLS').toEqual([]);
 });
},45000);

for(const theme of ['gold','mono'] as const)it('DESKTOP '+theme+' hidden recovery and keyboard actions retain desktop hover layout',async():Promise<void>=>{
 await withSession(theme,1280,800,async s=>{
  expect(await s.page.evaluate(()=>({fine:matchMedia('(pointer:fine)').matches,hover:matchMedia('(hover:hover)').matches}))).toEqual({fine:true,hover:true});
  const panel=s.page.locator('[data-popup="layer-panel"]'),card=panel.getByTitle('触控图层 Alpha',{exact:true}),hide=card.getByTitle('隐藏图层',{exact:true});
  const before=await s.page.evaluate(()=>window.onFixture.snapshot());
  expect(await hide.evaluate(el=>getComputedStyle(el.parentElement!).position)).toBe('absolute');
  expect(await hide.evaluate(el=>getComputedStyle(el.parentElement!).opacity)).toBe('0');
  await card.hover();expect(await hide.evaluate(el=>getComputedStyle(el.parentElement!).opacity)).toBe('1');
  await hide.focus();expect(await hide.evaluate(el=>document.activeElement===el)).toBe(true);await hide.press('Enter');await settle(s.page);
  const show=card.getByTitle('显示图层',{exact:true});expect(await show.getAttribute('aria-pressed')).toBe('false');
  expect(await card.evaluate(el=>getComputedStyle(el).opacity)).toBe('0.5');
  expect(await show.evaluate(el=>document.activeElement===el)).toBe(true);await show.press('Enter');await settle(s.page);
  expect(await card.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
  expect(await card.evaluate(el=>el.getAnimations().some(a=>a.effect instanceof KeyframeEffect&&a.effect.getKeyframes().some(k=>'opacity'in k)))).toBe(false);
  const lock=card.getByTitle('锁定图层',{exact:true});await lock.focus();expect(await lock.evaluate(el=>document.activeElement===el)).toBe(true);await lock.press('Space');await settle(s.page);
  expect(await card.getByTitle('解锁图层',{exact:true}).getAttribute('aria-pressed')).toBe('true');
  const after=await s.page.evaluate(()=>window.onFixture.snapshot());
  expect(after.images[0]).toEqual({...before.images[0],locked:true});expect(after.images.slice(1)).toEqual(before.images.slice(1));
  expect(after.actions).toEqual([{action:'visible',id:'on-alpha',value:false},{action:'visible',id:'on-alpha',value:true},{action:'locked',id:'on-alpha',value:true}]);
  console.log('DESKTOP_LAYER_KEYBOARD '+JSON.stringify({theme,hiddenRestorable:true,keyboardEnterAndSpace:true,hoverLayoutPreserved:true}));
 },true);
},45000);
