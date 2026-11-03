// @vitest-environment node
// AV exercises real DataManager through the unchanged AT Dashboard host.
// Exact GET plans only; no server forwarding, storage, payment or downloads.
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,withSession,main,activate,reach,readable,reveal,settle,quiet,geometry,noHorizontalOverflow,capture,heldRead,observeJsonReads,jsonReads,type Session,type ReadReply,type NativePlan,type MatrixEntry} from '../helpers/data-manager-av-native-fixture';
const MATRIX_AV=[...MATRIX,{theme:'gold',width:390,height:844},{theme:'mono',width:390,height:844}] as const;
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jivsAAAAASUVORK5CYII=';
const Q='/api/admin/user-images?page=1&pageSize=24';
const Q2='/api/admin/user-images?page=2&pageSize=24';
const F=Q+'&source=generated';
const S=F+'&search=x';
const U=Q+'&userId=av-user';
function record(id:string,prompt:string):Record<string,unknown>{return {id,url:PNG,prompt,model:'AV model',quality:'standard',aspectRatio:'1:1',createdAt:1,projectId:'av-project',projectName:'AV project',originalWidth:1,originalHeight:1,source:'generated',apiProvider:'AV provider',userId:'av-user',userName:'AV test user'};}
function response(prompt='AV image',total=1,page=1):Record<string,unknown>{return {images:total?Array.from({length:Math.min(24,Math.max(0,total-(page-1)*24))},(_,i)=>record('av-'+page+'-'+i,total===1?prompt:prompt+' '+((page-1)*24+i+1))):[],total,page,pageSize:24,stats:{totalUsers:1,filteredUsers:1,totalImages:total,generated:total,uploaded:0,edited:0,userStats:total?[{userId:'av-user',userName:'AV test user',totalImages:total,generated:total,uploaded:0,edited:0,projectCount:1}]:[]}};}
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},'/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},'/api/ecom-templates':{success:true,templates:[]},
};
function reply(body:unknown,count=1,extra:Partial<ReadReply>={}):ReadReply{return {count,body,...extra};}
function plan(steps:ReadonlyArray<Record<string,ReadReply>>):NativePlan{
 const base=Object.fromEntries(Object.entries(BASE).map(([k,body])=>[k,reply(body)]));let current={...base};
 return {kind:'data',steps:[base,...steps.map(step=>(current={...current,...step}))]};
}
function btn(s:Session,name:string):Locator{return main(s).getByRole('button',{name,exact:true});}
async function press(s:Session,el:Locator,oneLine=true):Promise<void>{
 if(s.page.viewportSize()!.width<768){await activate(s,el,oneLine);return;}
 await readable(s,el,oneLine);const g=await geometry(el);expect(g.fiveHits).toBe(true);
 await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2);await settle(s);
}
async function nav(s:Session,pending=false,step=1):Promise<void>{
 const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
 const data=s.page.getByRole('navigation').getByRole('button',{name:'数据管理',exact:true});await reveal(s,data);s.step=step;await activate(s,data);
 await main(s).getByRole('heading',{name:'数据管理',exact:true}).waitFor();if(!pending)await settle(s);
}
async function edit(s:Session,el:Locator,value:string,wait=true):Promise<void>{
 if(s.page.viewportSize()!.width<768)await reach(s,el);else await readable(s,el);
 const box=await el.boundingBox();if(!box)throw Error('AV_FIELD_BOX');await s.page.mouse.click(box.x+box.width/2,box.y+box.height/2);await s.page.keyboard.press('Control+A');
 if(value)await s.page.keyboard.type(value);else await s.page.keyboard.press('Backspace');if(wait)await settle(s);
 expect(await el.inputValue()).toBe(value);
}
async function chooseSource(s:Session,index:number):Promise<void>{
 const el=main(s).getByRole('combobox');await reach(s,el);const box=await el.boundingBox();if(!box)throw Error('AV_SOURCE_BOX');
 await s.page.mouse.click(box.x+box.width/2,box.y+box.height/2);await s.page.keyboard.press('Home');for(let i=0;i<index;i++)await s.page.keyboard.press('ArrowDown');await s.page.keyboard.press('Enter');await settle(s);
}
async function openCard(s:Session):Promise<Locator>{
 const tile=main(s).locator('img').first().locator('..').locator('..');await reveal(s,tile);const g=await geometry(tile);expect(g.clear).toBe(true);expect(g.fiveHits).toBe(true);
 await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2);await settle(s);return tile;
}
async function modalKeyboard(entry:MatrixEntry):Promise<void>{
 const longUser='AV用户'+ '合法长用户名和ID'.repeat(12);
 await withSession(entry,plan([{[Q]:reply({...response(),images:[{...record('av-long-user','AV image'),userName:longUser}]})}]),async s=>{
  await nav(s);await press(s,btn(s,'内容库'));const origin=await openCard(s);let modal=s.page.getByRole('dialog',{name:'图片详情',exact:true});await modal.waitFor();
  const close=modal.getByRole('button',{name:'关闭图片详情',exact:true}),download=modal.getByRole('link',{name:'下载原图',exact:true});
  expect(await close.evaluate(e=>e===document.activeElement),'actual entry focus belongs to detail close').toBe(true);
  await s.page.keyboard.press('Tab');expect(await download.evaluate(e=>e===document.activeElement)).toBe(true);
  await s.page.keyboard.press('Tab');expect(await close.evaluate(e=>e===document.activeElement),'Tab wraps inside detail').toBe(true);
  await s.page.keyboard.press('Shift+Tab');expect(await download.evaluate(e=>e===document.activeElement),'Shift+Tab wraps inside detail').toBe(true);
  await s.page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});await settle(s);
  expect(await origin.evaluate(e=>e===document.activeElement),'Escape returns focus to the actual originating card').toBe(true);
  await s.page.keyboard.press('Enter');await modal.waitFor();expect(await close.evaluate(e=>e===document.activeElement)).toBe(true);
  await press(s,close);await modal.waitFor({state:'hidden'});await settle(s);expect(await origin.evaluate(e=>e===document.activeElement)).toBe(true);
  await press(s,btn(s,'列表视图'));await noHorizontalOverflow(s);await readable(s,main(s).getByText(longUser,{exact:true}),false);const listOrigin=await openCard(s);modal=s.page.getByRole('dialog',{name:'图片详情',exact:true});await modal.waitFor();
  await s.page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});await settle(s);expect(await listOrigin.evaluate(e=>e===document.activeElement)).toBe(true);
  await s.page.keyboard.press('Space');await modal.waitFor();await readable(s,modal.getByText('AV image',{exact:true}).first());await noHorizontalOverflow(s);await capture(s,'av-keyboard-detail');
  await s.page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});await settle(s);expect(await listOrigin.evaluate(e=>e===document.activeElement)).toBe(true);await quiet(s);
 });
}
describe.each(MATRIX_AV)('AV data $theme $width x $height',entry=>{
 it('pagination and source search resets emit only their exact current query',async():Promise<void>=>{
  // Catches page2 requests issued for a new filter, forgotten query fields,
  // paging overflow, tiny/unlabelled arrows and losing the current-page state.
  const p=plan([{[Q]:reply(response('AV page',120))},{[Q2]:reply(response('AV page',120,2))},{[F]:reply(response('AV generated',48))},{[S]:reply(response('AV x'))},{[F]:reply(response('AV generated',48),2)},{[Q]:reply(response('AV page',120),2)}]);
  await withSession(entry,p,async s=>{
   await nav(s);await press(s,btn(s,'内容库'));await noHorizontalOverflow(s);
   s.step=2;await press(s,btn(s,'2'));await settle(s);await readable(s,main(s).getByText('第 2/5 页',{exact:true}));
   s.step=3;await chooseSource(s,1);await readable(s,main(s).getByText('第 1/2 页',{exact:true}));
   s.step=4;await edit(s,main(s).getByPlaceholder('搜索提示词、模型...'),'x');await main(s).getByAltText('AV x',{exact:true}).waitFor();
   s.step=5;await edit(s,main(s).getByPlaceholder('搜索提示词、模型...'),'');
   s.step=6;await chooseSource(s,0);await readable(s,main(s).getByText('第 1/5 页',{exact:true}));
   await reach(s,btn(s,'上一页'));expect(await btn(s,'上一页').isDisabled()).toBe(true);await reach(s,btn(s,'下一页'));
   expect(await btn(s,'1').getAttribute('aria-current')).toBe('page');await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('read failure and malformed retry show an actionable alert before a genuine empty result',async():Promise<void>=>{
  // Catches HTTP errors silently presented as an empty dataset, malformed DTO
  // accepted as success, and retry losing its query or leaving stale errors.
  await withSession(entry,plan([{[Q]:reply({error:'synthetic unavailable'},1,{status:503})},{[Q]:reply({images:null,total:0,stats:null},2)},{[Q]:reply(response('',0),3)}]),async s=>{
   await nav(s);await press(s,btn(s,'内容库'));const alert=main(s).getByRole('alert');await alert.waitFor();await readable(s,alert);expect(await alert.textContent()).toContain('503');
   s.step=2;await press(s,alert.getByRole('button',{name:'重试',exact:true}));await settle(s);await alert.waitFor();expect(await alert.textContent()).toContain('格式');
   s.step=3;await press(s,alert.getByRole('button',{name:'重试',exact:true}));await settle(s);expect(await alert.count()).toBe(0);
   await readable(s,main(s).getByText('暂无数据',{exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('a held obsolete read cannot replace a newer filtered result after it finishes',async():Promise<void>=>{
  // Catches a late old response overwriting new search results or loading state.
  await withSession(entry,plan([{[Q]:reply(response('AV obsolete'),1,{hold:true})},{[Q+'&search=x']:reply(response('AV newest'))}]),async s=>{
   await nav(s,true);await activate(s,btn(s,'内容库'));await main(s).getByText('加载数据中...',{exact:true}).waitFor();
   s.step=2;await edit(s,main(s).getByPlaceholder('搜索提示词、模型...'),'x',false);await main(s).getByAltText('AV newest',{exact:true}).waitFor();
   s.releaseRefresh.resolve();await settle(s);expect(await main(s).getByAltText('AV newest',{exact:true}).count()).toBe(1);expect(await main(s).getByAltText('AV obsolete',{exact:true}).count()).toBe(0);
   expect(await main(s).getByText('加载数据中...',{exact:true}).count()).toBe(0);await quiet(s);
  });
 },25000);
 it('image detail supports native keyboard entry wrap escape and return in both gallery layouts',async():Promise<void>=>{await modalKeyboard(entry);},25000);
 it('user filtering clear and user-list breadcrumb keep the intended return view and current query',async():Promise<void>=>{
  // Catches mouse-only ranking, unlabelled clear-filter and incorrect return
  // state/query when selecting a user from overview versus the user table.
  await withSession(entry,plan([{[Q]:reply(response())},{[U]:reply(response())},{[Q]:reply(response(),2)},{[U]:reply(response(),2)},{[Q]:reply(response(),3)}]),async s=>{
   await nav(s);s.step=2;await press(s,btn(s,'查看用户 AV test user 的内容'),false);await settle(s);await reach(s,btn(s,'清除用户筛选'));
   s.step=3;await press(s,btn(s,'清除用户筛选'));await settle(s);expect(await btn(s,'清除用户筛选').count()).toBe(0);
   await press(s,btn(s,'用户数据'));const table=main(s).getByRole('region',{name:'用户数据表，可横向滚动',exact:true});await reveal(s,table);const b=await table.boundingBox();if(!b)throw Error('AV_USER_TABLE');await s.page.mouse.move(b.x+b.width/2,Math.min(entry.height-2,b.y+b.height/2));await s.page.mouse.wheel(2000,0);await settle(s);
   s.step=4;await press(s,table.getByRole('button',{name:'查看内容',exact:true}));await settle(s);
   const breadcrumb=main(s).getByRole('navigation',{name:'数据内容导航',exact:true});s.step=5;await press(s,breadcrumb.getByRole('button',{name:'用户数据',exact:true}));await settle(s);
   await readable(s,main(s).getByRole('heading',{name:'用户数据概览',exact:true}));await quiet(s);
  });
 },25000);
});

describe.each(MATRIX_AV)('AV review data $theme $width x $height',entry=>{
 it('nested malformed source and user stats are rejected before a valid retry',async():Promise<void>=>{
  const source = {...response(),images:[{...record('bad','AV invalid source'),source:['generated']}]};
  const nested = {...response(),stats:{...(response().stats as Record<string,unknown>),userStats:[{userId:'av-user',userName:'AV test user',totalImages:1,generated:'1',uploaded:0,edited:0,projectCount:1}]}};
  await withSession(entry,plan([{[Q]:reply(source)},{[Q]:reply(nested,2)},{[Q]:reply(response(),3)}]),async s=>{
   await nav(s);const alert=main(s).getByRole('alert');await alert.waitFor();expect(await alert.textContent()).toContain('格式');
   expect(await btn(s,'查看用户 AV test user 的内容').count()).toBe(0);
   s.step=2;await activate(s,alert.getByRole('button',{name:'重试',exact:true}));await settle(s);expect(await alert.textContent()).toContain('格式');
   s.step=3;await activate(s,alert.getByRole('button',{name:'重试',exact:true}));await settle(s);expect(await alert.count()).toBe(0);
   await reach(s,btn(s,'查看用户 AV test user 的内容'),false);await quiet(s);
  });
 },25000);
 it('obsolete failure cannot erase new success or clear a newer pending loading state',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:reply({error:'late unavailable'},1,{hold:'old',status:503})},{[Q+'&search=x']:reply(response('AV newest'))}]),async s=>{
   await nav(s,true);await heldRead(s,'old');await activate(s,btn(s,'内容库'));
   s.step=2;await edit(s,main(s).getByPlaceholder('搜索提示词、模型...'),'x',false);await main(s).getByAltText('AV newest',{exact:true}).waitFor();
   s.readHolds.old.release.resolve();await settle(s);expect(await main(s).getByAltText('AV newest',{exact:true}).count()).toBe(1);
   expect(await main(s).getByRole('alert').count()).toBe(0);expect(await main(s).getByText('加载数据中...',{exact:true}).count()).toBe(0);await quiet(s);
  });
  await withSession(entry,plan([{[Q]:reply(response('AV old completion'),1,{hold:'old'})},{[Q+'&search=x']:reply(response('AV newer completion'),1,{hold:'new'})}]),async s=>{
   await observeJsonReads(s);await nav(s,true);await heldRead(s,'old');await activate(s,btn(s,'内容库'));
   s.step=2;await edit(s,main(s).getByPlaceholder('搜索提示词、模型...'),'x',false);await heldRead(s,'new');
   s.readHolds.old.release.resolve();await expect.poll(()=>s.completed.size).toBe(s.seen.size-1);
   // Wait for original JSON continuation, not an arbitrary timer; the new GET
   // remains explicitly held until these loading/absence assertions finish.
   await expect.poll(async()=>(await jsonReads(s)).length).toBe(1);
   expect(await main(s).locator('[aria-busy=true]').count()).toBe(1);
   await main(s).getByText('加载数据中...',{exact:true}).waitFor();expect(await main(s).getByAltText('AV old completion',{exact:true}).count()).toBe(0);
   s.readHolds.new.release.resolve();await settle(s);await main(s).getByAltText('AV newer completion',{exact:true}).waitFor();
   expect(await main(s).locator('[aria-busy=true]').count()).toBe(0);await quiet(s);
  });
 },25000);
 it('a real unmount before the old GET finishes suppresses its state payload reads',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:reply(response('AV unmounted'),1,{hold:'old'})},{[Q]:reply(response('AV remounted'),2)}]),async s=>{
   await observeJsonReads(s);await nav(s,true);await heldRead(s,'old');const root=await main(s).locator('[aria-busy]').elementHandle();expect(root).not.toBeNull();
   const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
   const projectsNav=s.page.getByRole('navigation').getByRole('button',{name:/^我的项目\s*0$/});
   await reveal(s,projectsNav);await readable(s,projectsNav.locator('span').nth(0),true);await readable(s,projectsNav.locator('span').nth(1),true);
   // The label and its smaller count badge are separate text runs. Check each
   // as one line, not their different font baselines as one shared text run.
   await activate(s,projectsNav,false);await main(s).getByRole('heading',{name:'我的项目',exact:true}).waitFor();
   expect(await root!.evaluate(e=>e.isConnected),'actual old component DOM disconnected before release').toBe(false);
   await nav(s,true,2);await activate(s,btn(s,'内容库'));await main(s).getByAltText('AV remounted',{exact:true}).waitFor();
   s.readHolds.old.release.resolve();await settle(s);const receipts=await jsonReads(s);
   expect(receipts.map(r=>r.url)).toEqual(['https://data-manager-av-fixture.invalid'+Q,'https://data-manager-av-fixture.invalid'+Q]);
   expect(receipts.map(r=>r.reads)).toEqual([
    ['images','total','stats','stats','images','images','total','stats'], // actual mounted acceptance calibrates observer
    ['images','total','stats','stats','images'], // validation only, no setter payload reads after unmount
   ]);
   console.log('AV_UNMOUNT_READ_RECEIPT',JSON.stringify({entry,receipts}));
   expect(await main(s).getByAltText('AV remounted',{exact:true}).count()).toBe(1);expect(await main(s).getByAltText('AV unmounted',{exact:true}).count()).toBe(0);await quiet(s);
  });
 },25000);
 it('detail restores root focus when its actual origin is independently disconnected',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:reply(response())}]),async s=>{
   await nav(s);await activate(s,btn(s,'内容库'));const origin=await openCard(s);await s.page.getByRole('dialog',{name:'图片详情',exact:true}).waitFor();
   // Fault injection only: restore exact element/position before React teardown.
   const restore=await origin.evaluateHandle(e=>{const parent=e.parentNode;if(!parent)throw Error('AV_ORIGIN_PARENT');const next=e.nextSibling;e.remove();return {element:e,parent,next};});
   try {
    await s.page.keyboard.press('Escape');await s.page.getByRole('dialog',{name:'图片详情',exact:true}).waitFor({state:'hidden'});await settle(s);
    expect(await main(s).locator('[aria-busy]').evaluate(e=>e===document.activeElement),'disconnected-origin fallback owns actual focus').toBe(true);
   } finally {await restore.evaluate(v=>{v.parent.insertBefore(v.element,v.next?.parentNode===v.parent?v.next:null);});await restore.dispose();}
   await quiet(s);
  });
 },25000);
});
describe.each([{theme:'gold',width:1280,height:900},{theme:'mono',width:1280,height:900}] as const)('AV desktop keyboard $theme',entry=>{
 it('actual grid and list detail preserve native keyboard focus on desktop',async():Promise<void>=>{await modalKeyboard(entry);},25000);
});

it('exact planned resource error never exempts same-text script console errors from actual cleanup',async():Promise<void>=>{
 // A broad console-error suppression would let quiet/disposal pass and fail
 // this calibration. The valid native503 has its own URL/status/count ledger.
 let session:Session|undefined,caught:unknown,quietRejected=false;
 try {
  await withSession({theme:'gold',width:320,height:640},plan([{[Q]:reply({error:'synthetic unavailable'},1,{status:503})}]),async s=>{
   session=s;await nav(s);expect(s.resourceConsoleReceipts).toEqual([{url:'https://data-manager-av-fixture.invalid'+Q,status:503,text:'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'}]);
   await s.page.evaluate(():void=>{console.error('Failed to load resource: the server responded with a status of 503 (Service Unavailable)');});
   try {await quiet(s);}catch{quietRejected=true;}
   expect(quietRejected,'same text from script is still rejected').toBe(true);
   expect(s.faults).toEqual(['AV_CONSOLE_ERROR Failed to load resource: the server responded with a status of 503 (Service Unavailable)']);
  });
 }catch(error){caught=error;}
 expect(caught).toBeInstanceOf(AggregateError);expect(String(caught)).toContain('AV_DISPOSAL');
 expect(session?.contextClosed&&session.pageClosed&&session.page.isClosed()).toBe(true);expect(session?.resourceConsoleReceipts.length).toBe(1);
},25000);
