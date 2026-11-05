// @vitest-environment node
// AO bridges actual GET/storage JSON and status into native actual mobile UI.
// SQL/session/pricing configuration alone are synthetic; no real Pool/payment/server.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MATRIX, withSession, main, history, readable, reach, balances, filter, capture,
  settled, failure, advance, noHorizontalOverflow, quiet, type Session, type ApiScope } from '../helpers/credits-native-bridge-fixture';
const mocks = vi.hoisted(() => ({ execSql:vi.fn(),getPool:vi.fn(),getAdvisoryLockPool:vi.fn(),isDatabaseConfigured:vi.fn(),getSessionUser:vi.fn(),loadCreditPricingConfig:vi.fn() }));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db-client',()=>({execSql:mocks.execSql,getPool:mocks.getPool,getAdvisoryLockPool:mocks.getAdvisoryLockPool,isDatabaseConfigured:mocks.isDatabaseConfigured}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:mocks.getSessionUser}));
vi.mock('@/lib/credit-pricing',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/credit-pricing')>(),loadCreditPricingConfig:mocks.loadCreditPricingConfig}));
import { GET } from '@/app/api/credits/route';
type StorageTransaction = Awaited<ReturnType<typeof import('@/lib/db-storage').dbGetCreditTransactions>>[number];
const USER='ao-credits-user';
const CREDIT={id:'ao-credit',user_id:USER,balance:42,total_recharged:100,total_used:58,created_at:1792368000000,updated_at:1792368000000};
const OLD={id:'ao-old',user_id:USER,type:'consume',amount:-58,balance_after:42,description:'AO原消费记录',reference_id:'ao-old-ref',created_at:1792368000000} satisfies StorageTransaction;
const NEW={id:'ao-new',user_id:USER,type:'recharge',amount:13,balance_after:55,description:'AO恢复后新增积分',reference_id:'ao-new-ref',created_at:1792368001000} satisfies StorageTransaction;
interface SqlRead {scope:ApiScope;kind:'balance'|'history';sql:string;params:unknown[]}
const state={active:null as ApiScope|null,reads:[] as SqlRead[],calls:[] as {scope:ApiScope;url:string}[],unexpected:[] as string[],writes:[] as string[],poolAttempts:0};
function deny(message:string):never{state.unexpected.push(message);throw Error(message);}
beforeEach(():void=>{
 Object.values(mocks).forEach(mock=>mock.mockReset());state.active=null;state.reads=[];state.calls=[];state.unexpected=[];state.writes=[];state.poolAttempts=0;
 mocks.getSessionUser.mockResolvedValue({id:USER,role:'user',status:'active'});
 mocks.isDatabaseConfigured.mockReturnValue(true);mocks.loadCreditPricingConfig.mockResolvedValue({modelCredits:{}});
 const pool=():never=>{state.poolAttempts++;throw Error('AO_REAL_POOL_FORBIDDEN');};mocks.getPool.mockImplementation(pool);mocks.getAdvisoryLockPool.mockImplementation(pool);
 mocks.execSql.mockImplementation(async(raw:string,params:unknown[]=[]):Promise<{rows:Record<string,unknown>[];rowCount:number}>=>{
  const sql=raw.replace(/\s+/g,' ').trim(),scope=state.active;
  if(/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK)\b/.test(sql)){state.writes.push(sql);return deny('AO_WRITE_FORBIDDEN');}
  if(!scope)return deny('AO_SQL_OUTSIDE_ACTUAL_GET');
  let rows:Record<string,unknown>[];
  if(sql==='SELECT * FROM wujie_credits WHERE user_id = $1'){
   if(JSON.stringify(params)!==JSON.stringify([USER]))return deny('AO_BALANCE_OWNER');
   state.reads.push({scope:{...scope},kind:'balance',sql,params:[...params]});
   if(scope.kind==='recovery'&&(scope.step===0||scope.step===3))throw Error(scope.step===0?'AO_INITIAL_BALANCE_FAILED':'AO_REFRESH_FAILED');
   rows=[scope.kind==='zero'?{...CREDIT,balance:0,total_recharged:0,total_used:0}:scope.step===4?{...CREDIT,balance:55,total_recharged:113}:CREDIT];
  }else if(sql==='SELECT * FROM wujie_credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3'){
   if(JSON.stringify(params)!==JSON.stringify([USER,50,0]))return deny('AO_HISTORY_OWNER_OR_PAGINATION');
   state.reads.push({scope:{...scope},kind:'history',sql,params:[...params]});
   if(scope.kind==='recovery'&&scope.step===1)throw Error('AO_HISTORY_FAILED');
   rows=scope.kind==='zero'?[]:scope.step===4?[NEW,OLD]:[OLD];
  }else return deny('AO_UNOWNED_SQL '+sql);
  return {rows,rowCount:rows.length};
 });
});
afterEach(():void=>{
 expect(state.active).toBeNull();expect(state.unexpected).toEqual([]);expect(state.writes).toEqual([]);expect(state.poolAttempts).toBe(0);
 expect(mocks.getPool).not.toHaveBeenCalled();expect(mocks.getAdvisoryLockPool).not.toHaveBeenCalled();
});
async function actualGet(url:string,scope:ApiScope):Promise<Response>{
 if(state.active)return deny('AO_OVERLAPPING_GET');
 state.active={...scope};state.calls.push({scope:{...scope},url});
 try{return await GET(new NextRequest(url));}finally{state.active=null;}
}
function sqlClosure(kind:'zero'|'recovery'):void{
 const expected=kind==='zero'?['balance:0','history:0']:['balance:0','balance:1','history:1','balance:2','history:2','balance:3','balance:4','history:4'];
 expect(state.reads.map(r=>r.kind+':'+r.scope.step)).toEqual(expected);
 expect(state.calls).toHaveLength(expected.length);expect(mocks.getSessionUser).toHaveBeenCalledTimes(expected.length);
 expect(mocks.loadCreditPricingConfig).toHaveBeenCalledTimes(kind==='zero'?1:3);
 console.log('AO_REAL_SQL_BOUNDARY_CLOSURE',JSON.stringify({kind,reads:state.reads,calls:state.calls,poolAttempts:state.poolAttempts,writes:state.writes}));
}
async function ledgerRow(s:Session,description:string,amount:string,after:string):Promise<void>{
 const row=history(s).getByText(description,{exact:true}).locator('..').locator('..');
 expect(await row.count()).toBe(1);
 const displayedAmount=row.getByText(amount,{exact:true}),displayedAfter=row.getByText('余额 '+after,{exact:true});
 expect(await displayedAmount.count(), 'actual transaction amount renders in its own row').toBe(1);
 expect(await displayedAfter.count(), 'actual balanceAfter maps to the row, not a zero fallback').toBe(1);
 await readable(s,displayedAmount,true);await readable(s,displayedAfter,true);
}
describe.each(MATRIX)('AO actual credits GET to mobile $theme $width x $height',entry=>{
 it('actual known zero and empty history stay unknown while held, then native filters show truthful empty states',async():Promise<void>=>{
  await withSession(entry,'zero',actualGet,async(s:Session):Promise<void>=>{
   const status=main(s).getByRole('status');expect(await status.count()).toBe(1);expect(await status.textContent()).toContain('正在加载积分数据');
   await readable(s,status);await balances(s,['—','—','—']);
   expect(await main(s).getByText(/暂无.*记录/).count()).toBe(0);
   expect(await main(s).getByRole('button',{name:'刷新',exact:true}).isDisabled()).toBe(true);
   expect(await main(s).getByRole('button',{name:'充值',exact:true}).count()).toBe(0);
   expect(s.releaseRefresh.settled).toBe(false);await capture(s,'actual-initial-held');
   s.releaseRefresh.resolve();await settled(s);
   expect(await main(s).getByRole('status').count()).toBe(0);expect(await main(s).getByRole('alert').count()).toBe(0);
   await balances(s,['0','0','0']);await reach(s,main(s).getByRole('button',{name:'刷新',exact:true}));
   for(const [name,message] of [['全部','暂无记录'],['收入','暂无收入记录'],['支出','暂无支出记录'],['全部','暂无记录']] as const){
    await filter(s,name);const empty=history(s).getByText(message,{exact:true});expect(await empty.count()).toBe(1);await readable(s,empty,true);
    await readable(s,main(s).getByText('共 0 条记录',{exact:true}),true);
   }
   await noHorizontalOverflow(s);await quiet(s);expect(s.receipts.map(r=>r.status)).toEqual([200,200]);sqlClosure('zero');
  });
 },25000);
 it('actual 500 balance/history errors recover; failed refresh preserves old data, later GET renders changed balance and rows',async():Promise<void>=>{
  await withSession(entry,'recovery',actualGet,async(s:Session):Promise<void>=>{
   await settled(s);let retry=await failure(s,'积分数据加载失败');await balances(s,['—','—','—']);
   expect(await main(s).getByText(/暂无.*记录/).count()).toBe(0);await capture(s,'actual-balance-500');
   await advance(s,1,retry);retry=await failure(s,'积分记录加载失败');await balances(s,['42','100','58']);
   expect(await main(s).getByText(/暂无.*记录/).count()).toBe(0);await capture(s,'actual-history-500');
   await advance(s,2,retry);expect(await main(s).getByRole('alert').count()).toBe(0);await balances(s,['42','100','58']);
   expect(await history(s).getByText('AO原消费记录',{exact:true}).count()).toBe(1);expect(await main(s).getByText('共 1 条记录',{exact:true}).count()).toBe(1);
   await advance(s,3,main(s).getByRole('button',{name:'刷新',exact:true}));retry=await failure(s,'积分数据加载失败');
   expect(await main(s).getByRole('alert').textContent()).toContain('保留上次');await balances(s,['42','100','58']);
   expect(await history(s).getByText('AO原消费记录',{exact:true}).count()).toBe(1);expect(await main(s).getByText('共 1 条记录',{exact:true}).count()).toBe(1);
   await ledgerRow(s,'AO原消费记录','-58','42');await capture(s,'actual-refresh-500-retains-data');await advance(s,4,retry);
   expect(await main(s).getByRole('alert').count()).toBe(0);expect(await main(s).getByRole('status').count()).toBe(0);await balances(s,['55','113','58']);
   expect(await history(s).getByText('AO原消费记录',{exact:true}).count()).toBe(1);
   const changed=history(s).getByText('AO恢复后新增积分',{exact:true});expect(await changed.count()).toBe(1);await readable(s,changed,true);
   expect(await main(s).getByText('共 2 条记录',{exact:true}).count()).toBe(1);
   await ledgerRow(s,'AO原消费记录','-58','42');await ledgerRow(s,'AO恢复后新增积分','+13','55');
   await noHorizontalOverflow(s);await quiet(s);expect(s.receipts.map(r=>r.status)).toEqual([500,200,500,200,200,500,200,200]);sqlClosure('recovery');
  });
 },25000);
});
