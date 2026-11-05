// @vitest-environment node
// AT: actual Dashboard -> Gateway and real Radix portals/CSS. Synthetic HTTP
// never reaches any server; fake secret below is public test data, not a key.
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,ORIGIN,withSession,withGeometryCalibration,geometry,contrast,main,activate,reach,readable,reveal,settle,quiet,ui,capture,noHorizontalOverflow,type Session,type ReadReply,type NativePlan} from '../helpers/gateway-at-native-fixture';

interface KeyDto {id:string;userId:string;keyPrefix:string;label:string;requestsPerMinute:number;dailyQuota:number;todayUsage:number;enabled:boolean;createdBy:string;createdAt:string;lastUsedAt:string|null;revokedAt:string|null}
const LABEL='AT合成媒体客户端ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const USER='at-user-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const KEY:KeyDto={id:'gwkey_at_primary',userId:USER,keyPrefix:'wmg_at000001',label:LABEL,requestsPerMinute:60,dailyQuota:100000,todayUsage:9007199254740991,enabled:true,createdBy:'at-admin',createdAt:'2026-10-19T00:00:00.000Z',lastUsedAt:'2026-10-19T01:00:00.000Z',revokedAt:null};
const REVOKED:KeyDto={...KEY,id:'gwkey_at_revoked',userId:'at-revoked-user',label:'AT已吊销测试项',keyPrefix:'wmg_at000002',todayUsage:0,enabled:false,revokedAt:'2026-10-19T02:00:00.000Z'};
const FAKE_SECRET='wmg_atFAKE01'+'x'.repeat(35);
const ISSUED:KeyDto={...KEY,id:'gwkey_at_issued',userId:'at-local-user',label:'AT local issue',keyPrefix:'wmg_atFAKE01',dailyQuota:0,todayUsage:0,lastUsedAt:null};
const URL='/api/admin/gateway/keys';
const BASE_BODIES:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},
 '/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},
 '/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},
 '/api/ecom-templates':{success:true,templates:[]},
};
function base():Record<string,ReadReply>{return Object.fromEntries(Object.entries(BASE_BODIES).map(([p,body])=>[p,{count:1,body}]));}
function plan(list:ReadReply={count:1,body:{success:true,keys:[KEY,REVOKED]}},mutation?:[string,ReadReply],retry?:ReadReply):NativePlan{
 const first=base(),second={...first,[URL]:list},steps:Array<Record<string,ReadReply>>=[first,second];
 if(mutation)steps.push({...second,[mutation[0]]:mutation[1]});
 if(retry)steps.push({...second,[URL]:retry});
 return {kind:'gateway',steps};
}
async function navigate(s:Session,wait=true):Promise<void>{
 await activate(s,s.page.getByRole('button',{name:'展开导航',exact:true}));
 const nav=s.page.getByRole('navigation').getByRole('button',{name:'媒体网关',exact:true});
 await reveal(s,nav);s.step=1;await activate(s,nav);
 await main(s).getByRole('heading',{name:'媒体网关',exact:true}).waitFor();
 if(wait)await settle(s);
 expect(await main(s).getByRole('heading',{name:'媒体网关',exact:true}).count()).toBe(1);
 if(wait)await quiet(s);
}
function btn(s:Session,name:string):Locator{return s.page.getByRole('button',{name,exact:true});}
function list(s:Session):Locator{return s.page.getByTestId('media-gateway-mobile-list');}
function row(s:Session,label=LABEL):Locator{return list(s).getByRole('article').filter({has:s.page.getByRole('heading',{name:label,exact:true})});}
async function fill(s:Session,control:Locator,value:string):Promise<void>{
 await reach(s,control);const box=await control.boundingBox();if(!box)throw Error('AT_FIELD_BOX');
 await s.page.mouse.click(box.x+box.width/2,box.y+box.height/2);await s.page.keyboard.press('Control+A');
 if(value)await s.page.keyboard.type(value);else await s.page.keyboard.press('Backspace');
 await settle(s);expect(await control.inputValue()).toBe(value);
}
async function sheet(s:Session,name:string):Promise<Locator>{
 const content=s.page.getByRole('dialog',{name,exact:true});await content.waitFor();await settle(s);
 if(await content.getAttribute('data-slot')==='sheet-content'){
  const header=content.locator('[data-slot=sheet-header]'),title=header.getByRole('heading'),description=header.locator('[data-slot=sheet-description]');
  await readable(s,title);await readable(s,description);
  const boxes=await content.evaluate((element:Element):{headerBottom:number;descriptionBottom:number;descriptionTop:number;titleBottom:number;fieldTop:number}=>{
   const header=element.querySelector('[data-slot=sheet-header]'),title=header?.querySelector('[data-slot=sheet-title]'),description=header?.querySelector('[data-slot=sheet-description]'),field=element.querySelector('label[for=gateway-user-id]');
   if(!header||!title||!description||!field)throw Error('AT_SHEET_SEMANTIC_PARTS');
   return {headerBottom:header.getBoundingClientRect().bottom,descriptionBottom:description.getBoundingClientRect().bottom,descriptionTop:description.getBoundingClientRect().top,titleBottom:title.getBoundingClientRect().bottom,fieldTop:field.getBoundingClientRect().top};
  });
  expect(boxes.titleBottom,'sheet title does not overlap description').toBeLessThanOrEqual(boxes.descriptionTop+0.5);
  expect(boxes.descriptionBottom,'sheet header owns all its text height').toBeLessThanOrEqual(boxes.headerBottom+0.5);
  expect(boxes.descriptionBottom,'sheet explanatory prose does not overlap the first field label').toBeLessThanOrEqual(boxes.fieldTop+0.5);
 }
 return content;
}
async function neutralPointer(s:Session):Promise<void>{await s.page.mouse.move(1,1);await s.page.getByRole('tooltip').waitFor({state:'hidden'});}

describe.each(MATRIX)('AT gateway $theme $width x $height',entry=>{
 it('long key identities and copy edit revoke controls fit the mobile list',async():Promise<void>=>{
  // Catches real full-label clipping and unusably small prefix/actions.
  await withSession(entry,plan(),async s=>{
   await navigate(s);const current=row(s);await readable(s,current.getByRole('heading',{name:LABEL,exact:true}));
   await readable(s,current.getByText(USER,{exact:true}));
   await readable(s,current.getByText('9007199254740991',{exact:true}),true);
   expect(await contrast(current.getByText('正常',{exact:true}))).toBeGreaterThanOrEqual(4.5);
   await activate(s,current.getByRole('button',{name:'复制前缀',exact:true}));
   expect((await ui(s)).clipboardWrites).toEqual(['wmg_at000001']);await neutralPointer(s);
   await reach(s,current.getByRole('button',{name:'编辑 '+LABEL,exact:true}));await reach(s,current.getByRole('button',{name:'吊销 '+LABEL,exact:true}));
   expect(await row(s,REVOKED.label).getByRole('button',{name:'编辑 '+REVOKED.label,exact:true}).isDisabled()).toBe(true);
   expect(await row(s,REVOKED.label).getByRole('button',{name:'吊销 '+REVOKED.label,exact:true}).isDisabled()).toBe(true);
   await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('issue validation and one-time synthetic secret remain reachable and close securely',async():Promise<void>=>{
  // Catches invalid blank submission, wrong request body, unreachable secret
  // copy/close in short landscape, or secret remaining after close.
  const requestBody={userId:'at-local-user',label:'AT local issue',requestsPerMinute:60,dailyQuota:0};
  const p=plan({count:1,body:{success:true,keys:[KEY]}},['POST '+URL,{count:1,status:201,requestBody,body:{success:true,key:ISSUED,secret:FAKE_SECRET}}]);
  await withSession(entry,p,async s=>{
   await navigate(s);await activate(s,btn(s,'签发密钥'));const form=await sheet(s,'签发媒体网关密钥');
   await activate(s,form.getByRole('button',{name:'确认签发',exact:true}));
   await readable(s,form.getByRole('alert'));await quiet(s);
   await fill(s,form.getByLabel('用户 ID',{exact:true}),'at-local-user');await fill(s,form.getByLabel('标签',{exact:true}),'AT local issue');
   await fill(s,form.getByLabel('日配额',{exact:true}),'0');await reach(s,form.getByLabel('每分钟请求数',{exact:true}));
   s.step=2;await activate(s,form.getByRole('button',{name:'确认签发',exact:true}));
   const secret=await sheet(s,'密钥签发成功');await readable(s,secret.getByText(FAKE_SECRET,{exact:true}));
   expect(await contrast(secret.getByText(FAKE_SECRET,{exact:true}))).toBeGreaterThanOrEqual(4.5);
   await activate(s,secret.getByRole('button',{name:'复制 Secret',exact:true}));
   expect((await ui(s)).clipboardWrites).toEqual([FAKE_SECRET]);await neutralPointer(s);await noHorizontalOverflow(s);await capture(s,'one-time-synthetic-secret');
   await activate(s,secret.getByRole('button',{name:'关闭',exact:true}));await secret.waitFor({state:'hidden'});await settle(s);
   expect(await s.page.getByText(FAKE_SECRET,{exact:true}).count()).toBe(0);
   await readable(s,row(s,ISSUED.label).getByRole('heading',{name:ISSUED.label,exact:true}));await quiet(s);
  });
 },25000);
 it('edit dirty cancellation restores fields and exact synthetic patch updates the list',async():Promise<void>=>{
  // Catches dirty cancel failures, an enabled checkbox too small to touch,
  // incorrect PATCH target/body and lost list state after an accepted edit.
  const edited={...KEY,label:'AT saved draft',requestsPerMinute:42,dailyQuota:500,enabled:false};
  const requestBody={label:'AT saved draft',requestsPerMinute:42,dailyQuota:500,enabled:false};
  const p=plan(undefined,['PATCH '+URL+'/'+KEY.id,{count:1,requestBody,body:{success:true,key:edited}}]);
  await withSession(entry,p,async s=>{
   await navigate(s);await activate(s,btn(s,'编辑 '+LABEL));let form=await sheet(s,'编辑媒体网关密钥');
   expect(await form.getByLabel('用户 ID',{exact:true}).isDisabled()).toBe(true);
   await fill(s,form.getByLabel('标签',{exact:true}),'AT must discard');await activate(s,form.getByRole('button',{name:'取消',exact:true}));await form.waitFor({state:'hidden'});
   await activate(s,btn(s,'编辑 '+LABEL));form=await sheet(s,'编辑媒体网关密钥');
   expect(await form.getByLabel('标签',{exact:true}).inputValue()).toBe(LABEL);
   await fill(s,form.getByLabel('标签',{exact:true}),'AT saved draft');await fill(s,form.getByLabel('每分钟请求数',{exact:true}),'42');await fill(s,form.getByLabel('日配额',{exact:true}),'500');
   const input=form.getByRole('checkbox',{name:'启用密钥',exact:true}),label=input.locator('..');await readable(s,label,true);
   const g=await geometry(label);expect(g.rect.height).toBeGreaterThanOrEqual(44);expect(g.fiveHits).toBe(true);
   await s.page.mouse.click(g.rect.x+g.rect.width/2,g.rect.y+g.rect.height/2);expect(await input.isChecked()).toBe(false);
   s.step=2;await activate(s,form.getByRole('button',{name:'保存修改',exact:true}));await form.waitFor({state:'hidden'});await settle(s);
   await readable(s,row(s,edited.label).getByText('已停用',{exact:true}));await noHorizontalOverflow(s);await quiet(s);
  });
 },25000);
 it('revoke confirmation can cancel then complete only the planned synthetic delete',async():Promise<void>=>{
  // Catches an inaccessible alert footer/title or cancel invoking DELETE.
  const revoked={...KEY,enabled:false,revokedAt:'2026-10-19T03:00:00.000Z'};
  const p=plan(undefined,['DELETE '+URL+'/'+KEY.id,{count:1,body:{success:true,key:revoked}}]);
  await withSession(entry,p,async s=>{
   await navigate(s);await activate(s,btn(s,'吊销 '+LABEL));let dialog=s.page.getByRole('alertdialog');await dialog.waitFor();await settle(s);
   await readable(s,dialog.getByRole('heading',{name:'吊销 '+LABEL,exact:true}));await activate(s,dialog.getByRole('button',{name:'取消',exact:true}));await dialog.waitFor({state:'hidden'});await quiet(s);
   await activate(s,btn(s,'吊销 '+LABEL));dialog=s.page.getByRole('alertdialog');await dialog.waitFor();await settle(s);await noHorizontalOverflow(s);await capture(s,'revoke-confirmation');
   s.step=2;await activate(s,dialog.getByRole('button',{name:'确认吊销',exact:true}));await dialog.waitFor({state:'hidden'});await settle(s);
   expect(await row(s).getByRole('button',{name:'吊销 '+LABEL,exact:true}).isDisabled()).toBe(true);await readable(s,row(s).getByText('已吊销',{exact:true}));await quiet(s);
  });
 },25000);
 it('untrusted list data shows a readable error and refresh reaches a real empty state',async():Promise<void>=>{
  // Catches a malformed complete DTO displayed as a real key, tiny retry or
  // overflow in the error/empty-state controls. This is not backend auth proof.
  const p=plan({count:1,body:{success:true,keys:[{...KEY,keyPrefix:FAKE_SECRET}]}},undefined,{count:2,body:{success:true,keys:[]}});
  await withSession(entry,p,async s=>{
   await navigate(s);await readable(s,main(s).getByRole('alert'));expect(await contrast(main(s).getByRole('alert'))).toBeGreaterThanOrEqual(4.5);
   expect(await list(s).count()).toBe(0);expect(await s.page.getByText(FAKE_SECRET,{exact:true}).count()).toBe(0);
   s.step=2;await activate(s,main(s).getByRole('button',{name:'刷新',exact:true}));await settle(s);await quiet(s);
   await readable(s,main(s).getByRole('heading',{name:'尚未签发媒体网关密钥',exact:true}));await noHorizontalOverflow(s);
  });
 },25000);
 it('held loading response is released before native refresh and resource cleanup',async():Promise<void>=>{
  // Catches loading state replaced prematurely or an unreachable refresh. The
  // hold is owned, unconditional disposal releases it; never change 5s timeout.
  const initial={count:1,hold:true,body:{success:true,keys:[KEY]}};
  const p=plan(initial,undefined,{count:2,body:{success:true,keys:[KEY]}});
  await withSession(entry,p,async s=>{
   await navigate(s,false);await main(s).getByRole('status',{name:'正在加载媒体网关密钥',exact:true}).waitFor();
   expect(await main(s).getByRole('button',{name:'刷新',exact:true}).isDisabled()).toBe(true);await capture(s,'owned-loading-state');
   s.releaseRefresh.resolve();await list(s).waitFor();await settle(s);await quiet(s);
   s.step=2;await activate(s,main(s).getByRole('button',{name:'刷新',exact:true}));await settle(s);await quiet(s);await noHorizontalOverflow(s);
  });
 },25000);
});

it('geometry calibration ignores genuinely assistive labels but rejects clipped visible prose',async():Promise<void>=>{
 await withGeometryCalibration(MATRIX[0],async page=>{
  await page.setContent('<html><head><style>body{margin:0}button{position:absolute;left:8px;top:8px;width:120px;height:44px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}#clipped{top:80px}#clipped span{display:block;width:10px;overflow:hidden;white-space:nowrap}</style></head><body><button id="assistive"><svg width="16" height="16"></svg><span class="sr-only">关闭</span></button><button id="clipped"><span>不可裁掉的完整文字</span></button></body></html>');
  const assistive=await geometry(page.locator('#assistive'));expect(assistive.glyphs).toBe(true);expect(assistive.clear).toBe(true);
  expect((await geometry(page.locator('#clipped'))).glyphs).toBe(false);
 });
},25000);

it('synthetic transport rejects an unplanned mutation body even when fetch rejection is caught',async():Promise<void>=>{
 let blocked=0,faults:string[]=[],cleanup:unknown;
 const p=plan({count:1,body:{success:true,keys:[]}},['POST '+URL,{count:1,requestBody:{userId:'at-user',label:'expected',requestsPerMinute:60,dailyQuota:0},body:{success:false}}]);
 try{await withSession(MATRIX[0],p,async s=>{
  await navigate(s);s.step=2;
  await s.page.evaluate(async url=>{try{await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'at-user',label:'unexpected',requestsPerMinute:60,dailyQuota:0})});}catch{/* Deliberately caught: the host ledger must still fail cleanup. */}},ORIGIN+URL);
  await settle(s);blocked=s.blockedHttp;faults=[...s.faults];
 });}catch(error){cleanup=error;}
 expect(blocked).toBe(1);expect(faults.some(f=>f.includes('AT_EXACT_SYNTHETIC_BODY'))).toBe(true);expect(cleanup).toBeInstanceOf(AggregateError);
},25000);

it('persistence boundary rejection remains fatal after the caller catches it',async():Promise<void>=>{
 let observed:{caught:string;ledger?:string[]}|undefined,cleanup:unknown;
 try{await withSession(MATRIX[0],plan(),async s=>{
  observed=await s.page.evaluate(():{caught:string;ledger?:string[]}=>{
   const app=(window as unknown as {atDashboard:{probePersistenceRejection():string;state:{persistenceFaults?:string[]}}}).atDashboard;
   const caught=app.probePersistenceRejection();return {caught,ledger:app.state.persistenceFaults};
  });
 });}catch(error){cleanup=error;}
 expect(observed?.caught).toContain('AT_FORBIDDEN_PERSISTENCE_saveProject');
 expect(observed?.ledger).toEqual(['AT_FORBIDDEN_PERSISTENCE_saveProject']);
 expect(cleanup).toBeInstanceOf(AggregateError);
 const error=cleanup as AggregateError;expect(error.message).toBe('AT_DISPOSAL');
 expect(error.errors.map((item:unknown):string=>String(item)).join('\n')).toContain('persistence attempts remain fatal even if caught');
},25000);
