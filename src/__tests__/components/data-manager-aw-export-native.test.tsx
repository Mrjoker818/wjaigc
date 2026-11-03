// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,withSession,main,activate,reach,readable,reveal,geometry,settle,quiet,heldRead,capture,noHorizontalOverflow,type Session,type ReadReply,type NativePlan} from '../helpers/data-manager-av-native-fixture';
const MATRIX_AW=[...MATRIX,{theme:'gold',width:390,height:844},{theme:'mono',width:390,height:844}] as const;
const legacy=process.env.WUJIE_AW_OBSERVE_LEGACY==='1'; // Only owned RED fixture phase; no production flag.
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jivsAAAAASUVORK5CYII=';
const Q='/api/admin/user-images?page=1&pageSize=24',U=Q+'&userId=aw-user',F=Q+'&source=generated&userId=aw-user',S=Q+'&source=generated&search=x&userId=aw-user',Y=Q+'&source=generated&search=y&userId=aw-user';
const E='/api/admin/user-images?page=1&pageSize=100',E2='/api/admin/user-images?page=2&pageSize=100';
const X1=E+'&source=generated&search=x&userId=aw-user',X2=E2+'&source=generated&search=x&userId=aw-user',X3='/api/admin/user-images?page=3&pageSize=100&source=generated&search=x&userId=aw-user';
const OLD='/api/admin/user-images?page=1&pageSize=10000&source=generated&userId=aw-user';
function image(index:number,prompt='x'):Record<string,unknown>{return {id:'aw-image-'+index,url:PNG,prompt,model:'AW model',source:'generated',userId:'aw-user',userName:'AW user',projectId:'aw-project',projectName:'AW project',apiProvider:'AW provider',createdAt:1};}
function dto(rows:number,total=rows,start=1,page=1,pageSize=100):Record<string,unknown>{return {images:Array.from({length:rows},(_,i)=>image(start+i)),total,page,pageSize,stats:{totalUsers:1,filteredUsers:1,totalImages:total,generated:total,uploaded:0,edited:0,userStats:[{userId:'aw-user',userName:'AW user',totalImages:total,generated:total,uploaded:0,edited:0,projectCount:1}]}};}
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},'/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},'/api/ecom-templates':{success:true,templates:[]},
};
function r(body:unknown,count=1,extra:Partial<ReadReply>={}):ReadReply{return {body,count,...extra};}
function plan(steps:ReadonlyArray<Record<string,ReadReply>>,downloads:readonly number[]):NativePlan{
 const base=Object.fromEntries(Object.entries(BASE).map(([key,body])=>[key,r(body)]));let current={...base};
 return {kind:'data',steps:[base,...steps.map(step=>(current={...current,...step}))],downloadCounts:[0,...downloads]};
}
function btn(s:Session,name:string):Locator{return main(s).getByRole('button',{name,exact:true});}
async function nav(s:Session):Promise<void>{
 const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
 const el=s.page.getByRole('navigation').getByRole('button',{name:'数据管理',exact:true});await reveal(s,el);s.step=1;await activate(s,el);await settle(s);
}
async function edit(s:Session,value:string,wait=true):Promise<void>{
 const el=main(s).getByPlaceholder('搜索提示词、模型...');await reach(s,el);const b=await el.boundingBox();if(!b)throw Error('AW_SEARCH_BOX');
 await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.press('Control+A');await s.page.keyboard.type(value);if(wait)await settle(s);
}
async function source(s:Session):Promise<void>{
 const el=main(s).getByRole('combobox');await reach(s,el);const b=await el.boundingBox();if(!b)throw Error('AW_SOURCE_BOX');
 await s.page.mouse.click(b.x+b.width/2,b.y+b.height/2);await s.page.keyboard.press('Home');await s.page.keyboard.press('ArrowDown');await s.page.keyboard.press('Enter');await settle(s);
}
async function exportReady(s:Session):Promise<void>{await activate(s,btn(s,'内容库'));await reach(s,btn(s,'导出'));}
async function downloaded(s:Session):Promise<unknown[]>{
 await expect.poll(()=>s.downloadReceipts.length).toBe(1);await settle(s);const receipt=s.downloadReceipts[0];
 const rows:unknown=JSON.parse(receipt.text);expect(Array.isArray(rows)).toBe(true);return rows as unknown[];
}

describe.each(MATRIX_AW)('AW data export $theme $width x $height',entry=>{
 it('complete filtered export preserves search user source and all205 actual downloaded rows',async():Promise<void>=>{
  // Missing search, stopping at server's first100 rows, mixing later filters,
  // duplicate submissions or early partial downloads must fail this case.
  const steps:Record<string,ReadReply>[]=[{[Q]:r(dto(1,205,1,1,24))},{[U]:r(dto(1,205,1,1,24))},{[F]:r(dto(1,205,1,1,24))},{[S]:r(dto(1,205,1,1,24))},
   legacy?{[OLD]:r(dto(100,205))}:{[X1]:r(dto(100,205)),[X2]:r(dto(100,205,101,2),1,{hold:'new'}),[X3]:r(dto(5,205,201,3))},
   legacy?{}:{[Y]:r({...dto(1),images:[image(999,'y')]})}];
  await withSession(entry,plan(steps,[0,0,0,0,1,1]),async s=>{
   await nav(s);s.step=2;await activate(s,btn(s,'查看用户 AW user 的内容'),false);await settle(s);
   s.step=3;await source(s);s.step=4;await edit(s,'x');await reach(s,btn(s,'导出'));
   s.step=5;await activate(s,btn(s,'导出'));
   if(!legacy){
    await heldRead(s,'new');expect(await btn(s,'导出').isDisabled()).toBe(true);expect(s.downloadReceipts).toEqual([]);
    await readable(s,main(s).getByRole('status',{name:'数据导出状态'}));await capture(s,'aw-export-pending');
    const g=await geometry(btn(s,'导出'));await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2); // genuine disabled second click
    s.step=6;await edit(s,'y',false);await main(s).getByAltText('y',{exact:true}).waitFor();s.readHolds.new.release.resolve();
   }else s.step=6;
   const rows=await downloaded(s);console.log('AW_EXPORT_ROW_RECEIPT',JSON.stringify({entry,legacy,rows:rows.length,first:rows[0],last:rows.at(-1)}));
   expect(rows.length,'full filtered file must contain all205, not only first100').toBe(205);
   expect(rows[0]).toEqual({id:'aw-image-1',prompt:'x',model:'AW model',source:'generated',userName:'AW user',userId:'aw-user',createdAt:'1970-01-01T00:00:00.001Z',projectName:'AW project',apiProvider:'AW provider'});
   expect((rows.at(-1) as {id:string}).id).toBe('aw-image-205');expect(new Set(rows.map(row=>(row as {id:string}).id)).size).toBe(205);
   expect(rows.every(row=>(row as {prompt:string}).prompt==='x')).toBe(true);
   await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('failed later page shows recovery without downloading a partial file and exact retry succeeds',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(dto(1,105,1,1,24))},{[E]:r(dto(100,105)),[E2]:r({error:'unavailable'},1,{status:503})},{[E]:r(dto(100,105),2),[E2]:r(dto(5,105,101,2),2)}],[0,0,1]),async s=>{
   await nav(s);await exportReady(s);s.step=2;await activate(s,btn(s,'导出'));await settle(s);
   const alert=main(s).getByRole('alert',{name:'数据导出失败'});await alert.waitFor();expect(await alert.textContent()).toContain('503');expect(s.downloadReceipts).toEqual([]);await reach(s,btn(s,'重新导出'));
   await capture(s,'aw-export-http-error');s.step=3;await activate(s,btn(s,'重新导出'));const rows=await downloaded(s);expect(rows.length).toBe(105);
   expect(await alert.count()).toBe(0);expect(await btn(s,'导出').isDisabled()).toBe(false);await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('a genuine empty export produces an actual empty JSON array and a visible completed status',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(dto(0,0,1,1,24))},{[E]:r(dto(0,0))}],[0,1]),async s=>{
   await nav(s);await exportReady(s);s.step=2;await activate(s,btn(s,'导出'));expect(await downloaded(s)).toEqual([]);
   const status=main(s).getByRole('status',{name:'数据导出状态'});await readable(s,status);expect(await status.textContent()).toContain('0');expect(await main(s).getByRole('alert').count()).toBe(0);await quiet(s);
  });
 },25000);
 it('leaving the real component before a held export page finishes prevents a late download',async():Promise<void>=>{
  await withSession(entry,plan([{[Q]:r(dto(1,205,1,1,24))},{[E]:r(dto(100,205)),[E2]:r(dto(100,205,101,2),1,{hold:'new'})}],[0,0]),async s=>{
   await nav(s);await exportReady(s);const oldRoot=await main(s).locator('[aria-busy]').elementHandle();expect(oldRoot).not.toBeNull();
   s.step=2;await activate(s,btn(s,'导出'));await heldRead(s,'new');
   const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
   const projects=s.page.getByRole('navigation').getByRole('button',{name:/^我的项目\s*0$/});await reveal(s,projects);
   await readable(s,projects.locator('span').nth(0),true);await readable(s,projects.locator('span').nth(1),true);await activate(s,projects,false);
   await main(s).getByRole('heading',{name:'我的项目',exact:true}).waitFor();expect(await oldRoot!.evaluate(e=>e.isConnected)).toBe(false);
   s.readHolds.new.release.resolve();await settle(s);expect(s.downloadObserved).toBe(0);expect(s.downloadReceipts).toEqual([]);await quiet(s);
  });
 },25000);
 for(const boundary of ['malformed','changed-total','repeated-page'] as const){
  it(boundary+' export page refuses an unsafe partial or duplicate file',async():Promise<void>=>{
   const second=boundary==='malformed'?{...dto(5,105,101,2),images:null}:boundary==='changed-total'?dto(5,106,101,2):dto(5,105,1,2);
   await withSession(entry,plan([{[Q]:r(dto(1,105,1,1,24))},{[E]:r(dto(100,105)),[E2]:r(second)}],[0,0]),async s=>{
    await nav(s);await exportReady(s);s.step=2;await activate(s,btn(s,'导出'));await settle(s);
    await main(s).getByRole('alert',{name:'数据导出失败'}).waitFor();expect(s.downloadReceipts).toEqual([]);expect(await btn(s,'导出').isDisabled()).toBe(false);await reach(s,btn(s,'重新导出'));await quiet(s);
   });
  },25000);
 }
});

it('an exact native JSON download slot never permits an extra native download through real cleanup',async():Promise<void>=>{
 let held:Session|undefined,caught:unknown,rejected=false;
 try {
  await withSession({theme:'gold',width:320,height:640},plan([{}],[1]),async s=>{
   held=s;s.step=1;
   const trigger=async():Promise<void>=>{await s.page.evaluate(():void=>{const url=URL.createObjectURL(new Blob(['[]'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='wujie-data-2026-10-19.json';a.click();URL.revokeObjectURL(url);});};
   await trigger();expect(await downloaded(s)).toEqual([]);await quiet(s);
   await trigger();await expect.poll(()=>s.faults.includes('AV_UNEXPECTED_DOWNLOAD')).toBe(true);
   try{await quiet(s);}catch{rejected=true;}expect(rejected).toBe(true);expect(s.downloadReceipts.length).toBe(1);
  });
 }catch(error){caught=error;}
 expect(caught).toBeInstanceOf(AggregateError);expect(String(caught)).toContain('AV_DISPOSAL');expect(held?.pageClosed&&held.contextClosed&&held.page.isClosed()).toBe(true);
},25000);
