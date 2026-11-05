// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {Locator} from '@playwright/test';
import {MATRIX,withSession,main,activate,reach,readable,reveal,settle,quiet,heldRead,noHorizontalOverflow,type Session,type ReadReply,type NativePlan} from '../helpers/recharge-orders-ay-native-fixture';

const MATRICES=[...MATRIX,{theme:'gold',width:390,height:844},{theme:'mono',width:390,height:844}] as const;
const LONG='AY合成用户名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const STATES=['submitted','pending','paid','rejected','cancelled'] as const;
const ORDERS=STATES.map((status,index)=>({orderId:'order_ay_'+status+'_1792390000000',userId:'ay-user-'+status,username:LONG+'-'+status,amount:1234.5+index,credits:10000+index,paymentMethod:index%2?'alipay':'wechat',status,createdAt:1792390000000,remark:status==='rejected'?'AY驳回原因ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789':''}));
const Q='POST /api/credits';
const BASE:Readonly<Record<string,unknown>>={
 '/api/credits/payment-status':{success:true,status:{wechat:false,alipay:false},canRecharge:false,methods:[]},'/api/credits/payment-config':{success:true,config:{wechatQrUrl:'',alipayQrUrl:''}},
 '/api/admin/users':{success:true,users:[]},'/api/admin/apis':{success:true,providers:[]},'/api/admin/groups':{success:true,groups:[]},'/api/admin/api-balance':{success:true,balances:[]},'/api/ecom-templates':{success:true,templates:[]},
};
const CREDIT_READS:Readonly<Record<string,unknown>>={
 '/api/credits':{success:true,credits:{balance:0,totalRecharged:0,totalUsed:0},pricing:{}},'/api/credits?transactions=true&limit=30':{success:true,transactions:[]},
 '/api/credits?action=admin-overview':{success:true,users:[]},'/api/credits?action=audit-orders':{success:true,orders:[]},
 '/api/admin/credits/overview':{totalUsers:0,totalRecharged:0,totalConsumed:0,totalBalance:0,topUsers:[],recentTransactions:[]},'/api/admin/credits/pricing':{models:[]},
};
function r(body:unknown,count=1,extra:Partial<ReadReply>={}):ReadReply{return {body,count,...extra};}
function listing(body:unknown={success:true,orders:ORDERS},count=1,extra:Partial<ReadReply>={}):ReadReply{return r(body,count,{requestBody:{action:'admin-all-orders'},...extra});}
function plan(reads:readonly ReadReply[],dialogs?:NativePlan['dialogCounts']):NativePlan{
 const base=Object.fromEntries(Object.entries(BASE).map(([k,b])=>[k,r(b)])),credits={...base,...Object.fromEntries(Object.entries(CREDIT_READS).map(([k,b])=>[k,r(b)]))};
 return {kind:'orders',steps:[base,credits,...reads.map(reply=>({...credits,[Q]:reply}))],...(dialogs?{dialogCounts:dialogs}:{})};
}
function btn(s:Session,name:string):Locator{return main(s).getByRole('button',{name,exact:true});}
async function nav(s:Session,held=false):Promise<void>{
 const open=s.page.getByRole('button',{name:'展开导航',exact:true});if(await open.isVisible())await activate(s,open);
 const item=s.page.getByRole('navigation').getByRole('button',{name:/^积分管理(?:\s*\d+)?$/});await reveal(s,item);
 for(const fragment of await item.locator('span').all())await readable(s,fragment,true);
 s.step=1;await activate(s,item,false);await settle(s);
 s.step=2;await activate(s,btn(s,'充值订单'));if(!held)await settle(s);
}
async function submitted(s:Session):Promise<void>{await readable(s,main(s).getByText(LONG+'-submitted',{exact:true}));await readable(s,main(s).getByText('¥1234.5',{exact:true}),true);}

describe.each(MATRICES)('AY orders $theme $width x $height',entry=>{
 it('nonempty orders and each status filter fit and remain operable without hidden financial actions',async():Promise<void>=>{
  await withSession(entry,plan([listing()]),async s=>{
   await nav(s);await readable(s,main(s).getByRole('heading',{name:'充值订单审核',exact:true}));await submitted(s);
   await reach(s,btn(s,'确认到账'));await reach(s,btn(s,'驳回'));await noHorizontalOverflow(s);
   for(const [label,status] of [['待支付','pending'],['已到账','paid'],['已驳回','rejected'],['全部','all'],['待审核 (1)','submitted']] as const){
    await activate(s,btn(s,label));await settle(s);
    const states=status==='all'?STATES:[status];
    for(const value of states)await readable(s,main(s).getByText(LONG+'-'+value,{exact:true}));
    expect(await main(s).getByText(LONG+'-submitted',{exact:true}).count()).toBe(status==='all'||status==='submitted'?1:0);
    await noHorizontalOverflow(s);
   }
   await quiet(s);
  });
 },25000);
 it('real confirm and reject prompt are dismissed with no financial request or changed order',async():Promise<void>=>{
  const d:NonNullable<NativePlan['dialogCounts']>=[{confirm:0,prompt:0},{confirm:0,prompt:0},{confirm:0,prompt:0},{confirm:1,prompt:0},{confirm:1,prompt:1}];
  await withSession(entry,plan([listing(),listing(),listing()],d),async s=>{
   await nav(s);s.step=3;await activate(s,btn(s,'确认到账'));await settle(s);expect(s.dialogCounts).toEqual({confirm:1,prompt:0});await submitted(s);
   s.step=4;await activate(s,btn(s,'驳回'));await settle(s);expect(s.dialogCounts).toEqual({confirm:1,prompt:1});await submitted(s);
   expect(s.counts.get('POST https://data-manager-av-fixture.invalid/api/credits')).toBe(1);await quiet(s);
  });
 },25000);
 it('held loading is not false empty then readonly failure is actionable and retry recovers',async():Promise<void>=>{
  await withSession(entry,plan([listing({success:true,orders:[]},1,{hold:'new'}),listing({success:false,error:'AY合成读取失败'},2),listing({success:true,orders:ORDERS},3)]),async s=>{
   await nav(s,true);await heldRead(s,'new');await readable(s,main(s).getByRole('status',{name:'订单加载状态',exact:true}));expect(await main(s).getByText('暂无待审核订单',{exact:true}).count()).toBe(0);
   s.readHolds.new.release.resolve();await settle(s);await readable(s,main(s).getByText('暂无待审核订单',{exact:true}));
   s.step=3;await activate(s,btn(s,'刷新'));await settle(s);const error=main(s).getByRole('alert',{name:'订单读取失败',exact:true});await readable(s,error);expect(await error.innerText()).toContain('AY合成读取失败');expect(await main(s).getByText('暂无待审核订单',{exact:true}).count()).toBe(0);
   s.step=4;await activate(s,error.getByRole('button',{name:'重新读取订单',exact:true}));await settle(s);expect(await error.count()).toBe(0);await submitted(s);await quiet(s);
  });
 },25000);
 it('status choices expose selected state and native keyboard can choose all without a mutation',async():Promise<void>=>{
  await withSession(entry,plan([listing()]),async s=>{
   await nav(s);expect(await btn(s,'待审核 (1)').getAttribute('aria-pressed')).toBe('true');const all=btn(s,'全部');await reveal(s,all);
   let focused=false;for(let n=0;n<16;n++){await s.page.keyboard.press('Tab');if(await all.evaluate(e=>e===document.activeElement)){focused=true;break;}}
   expect(focused,'bounded native Tab reaches status choice').toBe(true);await s.page.keyboard.press('Space');await settle(s);
   expect(await all.getAttribute('aria-pressed')).toBe('true');expect(await btn(s,'待审核 (1)').getAttribute('aria-pressed')).toBe('false');for(const value of STATES)await readable(s,main(s).getByText(LONG+'-'+value,{exact:true}));await quiet(s);
  });
 },25000);
});

for(const kind of ['mutation','wrong-dialog'] as const){
 it('readonly order boundary rejects '+kind+' at quiet and actual disposal',async():Promise<void>=>{
  let held:Session|undefined,caught:unknown,rejected=false;
  const seeded=plan([]),p:NativePlan={kind:'orders',steps:[seeded.steps[0],{...seeded.steps[0],...(kind==='mutation'?{[Q]:r({success:true},1,{requestBody:{action:'admin-confirm-paid',orderId:'order_ay_forbidden'}})}:{})}]};
  try{
   await withSession({theme:'gold',width:320,height:640},p,async s=>{
    held=s;s.step=1;
    if(kind==='mutation')await s.page.evaluate(async():Promise<void>=>{try{await fetch('/api/credits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'admin-confirm-paid',orderId:'order_ay_forbidden'})});}catch{}});
    else await s.page.evaluate(():void=>{confirm('AY unapproved dialog');});
    await expect.poll(()=>s.faults.length).toBeGreaterThan(0);try{await quiet(s);}catch{rejected=true;}expect(rejected).toBe(true);
   });
  }catch(error){caught=error;}
  expect(caught).toBeInstanceOf(AggregateError);expect(String(caught)).toContain('AV_DISPOSAL');expect(held?.pageClosed&&held.contextClosed&&held.page.isClosed()).toBe(true);
 },25000);
}
