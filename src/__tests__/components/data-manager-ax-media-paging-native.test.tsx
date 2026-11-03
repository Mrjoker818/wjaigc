// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,withSession,main,activate,reach,readable,reveal,settle,quiet,heldRead,capture,noHorizontalOverflow,type Session,type ReadReply,type NativePlan} from '../helpers/data-manager-av-native-fixture';
const MATRIX_AX=[...MATRIX,{theme:'gold',width:390,height:844},{theme:'mono',width:390,height:844}] as const;
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jivsAAAAASUVORK5CYII=';
const BAD='data:image/png;base64,AA=='; // Valid URL, real undecodable image bytes; not a synthetic onError invocation.
const Q='/api/admin/user-images?page=1&pageSize=24',Q2='/api/admin/user-images?page=2&pageSize=24',F=Q+'&source=generated',F2=Q2+'&source=generated',FX=F+'&search=x';
function record(index:number,url=PNG,prompt='AX item '+index):Record<string,unknown>{return {id:'ax-'+index,url,prompt,model:'AX model',createdAt:1,projectId:'ax-project',projectName:'AX project',source:'generated',apiProvider:'AX provider',userId:'ax-user',userName:'AX user'};}
function dto(total:number,page=1):Record<string,unknown>{return {images:Array.from({length:Math.max(0,Math.min(24,total-(page-1)*24))},(_,i)=>record((page-1)*24+i+1)),total,page,pageSize:24,stats:{totalUsers:1,filteredUsers:1,totalImages:total,generated:total,uploaded:0,edited:0,userStats:[{userId:'ax-user',userName:'AX user',totalImages:total,generated:total,uploaded:0,edited:0,projectCount:1}]}};}
function media(url=BAD,model='AX old model'):Record<string,unknown>{return {...dto(1),images:[{...record(1,url,'AX 原图'),model}]};}
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},'/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},'/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},'/api/ecom-templates':{success:true,templates:[]},
};
function r(body:unknown,count=1,extra:Partial<ReadReply>={}):ReadReply{return {body,count,...extra};}
function plan(steps:ReadonlyArray<Record<string,ReadReply>>):NativePlan{const base=Object.fromEntries(Object.entries(BASE).map(([key,body])=>[key,r(body)]));let current={...base};return {kind:'data',steps:[base,...steps.map(step=>(current={...current,...step}))]};}
function btn(s:Session,name:string):Locator{return main(s).getByRole('button',{name,exact:true});}
async function nav(s:Session):Promise<void>{const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);const data=s.page.getByRole('navigation').getByRole('button',{name:'数据管理',exact:true});await reveal(s,data);s.step=1;await activate(s,data);await settle(s);await activate(s,btn(s,'内容库'));}
async function source(s:Session):Promise<void>{const el=main(s).getByRole('combobox');await reach(s,el);const b=await el.boundingBox();if(!b)throw Error('AX_SOURCE_BOX');await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.press('Home');await s.page.keyboard.press('ArrowDown');await s.page.keyboard.press('Enter');await settle(s);}
async function searchX(s:Session):Promise<void>{const el=main(s).getByPlaceholder('搜索提示词、模型...');await reach(s,el);const b=await el.boundingBox();if(!b)throw Error('AX_SEARCH_BOX');await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.type('x');}
async function openBrokenDetail(s:Session):Promise<Locator>{
 const card=btn(s,'查看图片：AX 原图');await reveal(s,card);
 console.log('AX_GRID_ICONS',JSON.stringify(await card.locator('svg').evaluateAll(es=>es.map(e=>{
  const r=e.getBoundingClientRect();let opacity=1;for(let a:Element|null=e;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);
  return {class:e.getAttribute('class'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},opacity,parentClass:e.parentElement?.getAttribute('class')};
 }))));
 // The unchanged grid has a decorative opacity-0 hover eye. This is a native
 // mouse contract, not touch acceptance: move the real pointer before asking
 // the unchanged strict helper to inspect every descendant SVG, then click.
 const box=await card.boundingBox();if(!box)throw Error('AX_CARD_BOX');
 await s.page.mouse.move(box.x+box.width/2,box.y+box.height/2);await settle(s);
 const eye=card.locator('svg.lucide-eye');if(await eye.count())await expect.poll(()=>eye.evaluate(e=>Number(getComputedStyle(e.parentElement!).opacity))).toBeGreaterThan(0);
 await activate(s,card,false);const modal=s.page.getByRole('dialog',{name:'图片详情',exact:true});await modal.waitFor();return modal;
}
async function failure(modal:Locator):Promise<void>{await modal.getByText('原图暂不可用',{exact:true}).waitFor();expect(await modal.getByRole('img',{name:'原图暂不可用：AX 原图',exact:true}).isVisible()).toBe(true);}
async function loaded(el:Locator):Promise<boolean>{return await el.count()===1&&await el.evaluate(e=>e instanceof HTMLImageElement&&e.complete&&e.naturalWidth>0);}

describe.each(MATRIX_AX)('AX data media paging $theme $width x $height',entry=>{
 it('shrinking dataset returns an out-of-range second page to its real last page',async():Promise<void>=>{
  // A missing clamp accepts [] at page2,total1 and falsely shows empty/page2/1.
  await withSession(entry,plan([{[Q]:r(dto(48))},{[Q2]:r(dto(48,2))},{[Q2]:r(dto(1,2),2),[Q]:r(dto(1),2)}]),async s=>{
   await nav(s);s.step=2;await activate(s,btn(s,'2'));await settle(s);await readable(s,main(s).getByText('第 2/2 页',{exact:true}));
   s.step=3;await activate(s,btn(s,'刷新'));await settle(s);console.log('AX_PAGING_OBSERVATION',JSON.stringify({entry,text:await main(s).innerText()}));
   await main(s).getByText('第 1/1 页',{exact:true}).waitFor();await expect.poll(()=>loaded(main(s).getByAltText('AX item 1',{exact:true}))).toBe(true);
   expect(await main(s).getByText('暂无数据',{exact:true}).count()).toBe(0);await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('shrinking to zero resets page one and shows a genuine empty result without a redirect loop',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(dto(48))},{[Q2]:r(dto(48,2))},{[Q2]:r(dto(0,2),2),[Q]:r(dto(0),2)}]),async s=>{
   await nav(s);s.step=2;await activate(s,btn(s,'2'));await settle(s);s.step=3;await activate(s,btn(s,'刷新'));await settle(s);
   await main(s).getByText('第 1/1 页',{exact:true}).waitFor();await readable(s,main(s).getByText('暂无数据',{exact:true}));expect(await btn(s,'上一页').count()).toBe(0);await quiet(s);
  });
 },25000);
 it('an obsolete clamped-page reply cannot override a newer filtered query',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(dto(48))},{[F]:r(dto(48))},{[F2]:r(dto(48,2))},{[F2]:r(dto(1,2),2),[F]:r(dto(1),2,{hold:'old'})},{[FX]:r({...dto(1),images:[record(999,PNG,'AX newest')]})}]),async s=>{
   await nav(s);s.step=2;await source(s);s.step=3;await activate(s,btn(s,'2'));await settle(s);
   s.step=4;await activate(s,btn(s,'刷新'));await heldRead(s,'old');expect(await main(s).getByText('暂无数据',{exact:true}).count()).toBe(0);
   s.step=5;await searchX(s);await main(s).getByAltText('AX newest',{exact:true}).waitFor();s.readHolds.old.release.resolve();await settle(s);
   expect(await main(s).getByAltText('AX newest',{exact:true}).count()).toBe(1);expect(await main(s).getByAltText('AX item 1',{exact:true}).count()).toBe(0);await quiet(s);
  });
 },25000);
 it('broken original remains discoverable in grid list and detail then fresh original info recovers actual pixels',async():Promise<void>=>{
  // Removing failure UI, replacing a failed image with an unrelated sample,
  // dropping metadata or using a stale selected row must fail this scenario.
  await withSession(entry,plan([{[Q]:r(media())},{[Q]:r(media(PNG,'AX refreshed model'),2)}]),async s=>{
   await nav(s);console.log('AX_MEDIA_OBSERVATION',JSON.stringify({entry,images:await main(s).locator('img').evaluateAll(es=>es.map(e=>({complete:(e as HTMLImageElement).complete,naturalWidth:(e as HTMLImageElement).naturalWidth})))}));
   await btn(s,'查看图片：AX 原图').getByRole('img',{name:'原图暂不可用：AX 原图',exact:true}).waitFor();
   await activate(s,btn(s,'列表视图'));await btn(s,'查看图片：AX 原图').getByRole('img',{name:'原图暂不可用：图片',exact:true}).waitFor();
   const modal=await openBrokenDetail(s);await failure(modal);await readable(s,modal.getByText('原图暂不可用',{exact:true}));await capture(s,'ax-original-unavailable');
   const retry=modal.getByRole('button',{name:'重新加载原图',exact:true});await reach(s,retry);await s.page.keyboard.press('Tab');expect(await retry.evaluate(e=>e===document.activeElement)).toBe(true);
   s.step=2;await activate(s,retry);await settle(s);await expect.poll(()=>loaded(modal.getByAltText('AX 原图',{exact:true}))).toBe(true);
   await readable(s,modal.getByText('AX refreshed model',{exact:true}));expect(await modal.getByText('原图暂不可用',{exact:true}).count()).toBe(0);
   expect(await modal.getByRole('link',{name:'下载原图',exact:true}).getAttribute('href')).toBe(PNG);await capture(s,'ax-original-reloaded');
   await s.page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});await settle(s);expect(await btn(s,'查看图片：AX 原图').evaluate(e=>e===document.activeElement)||await main(s).locator('[aria-busy]').evaluate(e=>e===document.activeElement)).toBe(true);await quiet(s);
  });
 },25000);
 it('a still broken original stays failed after explicit retry and never claims ready',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(media())},{[Q]:r(media(),2)}]),async s=>{
   await nav(s);const modal=await openBrokenDetail(s);await failure(modal);s.step=2;await activate(s,modal.getByRole('button',{name:'重新加载原图',exact:true}));await settle(s);await failure(modal);
   expect(await modal.getByRole('button',{name:'重新加载原图',exact:true}).isDisabled()).toBe(false);expect(await modal.getByAltText('AX 原图',{exact:true}).count()).toBe(0);await quiet(s);
  });
 },25000);
 it('closing a detail during held original-info refresh does not reopen it on a late success',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(media())},{[Q]:r(media(PNG,'AX refreshed model'),2,{hold:'new'})}]),async s=>{
   await nav(s);const modal=await openBrokenDetail(s);await failure(modal);s.step=2;const retry=modal.getByRole('button',{name:'重新加载原图',exact:true});await activate(s,retry);await heldRead(s,'new');expect(await retry.isDisabled()).toBe(true);
   await s.page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});s.readHolds.new.release.resolve();await settle(s);
   expect(await s.page.getByRole('dialog',{name:'图片详情',exact:true}).count()).toBe(0);await expect.poll(()=>loaded(main(s).getByAltText('AX 原图',{exact:true}))).toBe(true);await quiet(s);
  });
 },25000);
});
