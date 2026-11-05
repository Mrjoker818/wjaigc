// @vitest-environment jsdom
// Real React development StrictMode replays this real component's mount effect.
// Only readonly listing transport is synthetic; no private state or paid action.
import React, {StrictMode} from 'react';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {AdminRechargeOrders} from '@/components/dashboard/admin-recharge-orders';

interface Read {promise:Promise<Response>;resolve:(value:Response)=>void;settled:boolean}
let reads:Read[]=[];
function deferred():Read{let resolve!:(value:Response)=>void;const result:Read={promise:new Promise<Response>(r=>{resolve=r;}),resolve:()=>undefined,settled:false};result.resolve=value=>{expect(result.settled,'each readonly response is released once').toBe(false);result.settled=true;resolve(value);};return result;}
function response(body:unknown):Response{return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});}
const ORDER={orderId:'order_ay_read_new',userId:'ay-user',username:'AY最新读取用户',amount:1,credits:10,paymentMethod:'wechat',status:'submitted',createdAt:1};
beforeEach(()=>{
 reads=[];
 vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  expect(input).toBe('/api/credits');expect(init?.method).toBe('POST');expect(JSON.parse(String(init?.body))).toEqual({action:'admin-all-orders'});
  const d=deferred();reads.push(d);return d.promise;
 }));
});
afterEach(async():Promise<void>=>{
 await act(async():Promise<void>=>{cleanup();for(const d of reads)if(!d.settled)d.resolve(response({success:true,orders:[]}));await Promise.all(reads.map(d=>d.promise));});
 expect(reads.every(d=>d.settled)).toBe(true);vi.unstubAllGlobals();vi.restoreAllMocks();
});
async function release(index:number,body:unknown):Promise<void>{await act(async():Promise<void>=>{reads[index].resolve(response(body));await reads[index].promise;});}
async function mount():Promise<void>{await act(async():Promise<void>=>{render(<StrictMode><AdminRechargeOrders/></StrictMode>);});expect(reads.length,'actual StrictMode mount-effect replay produces two owned readonly requests').toBe(2);}

describe('AY actual readonly mount replay',()=>{
 it('old failure cannot erase newer success',async():Promise<void>=>{
  await mount();await release(1,{success:true,orders:[ORDER]});expect(screen.getByText(ORDER.username,{exact:true})).toBeTruthy();
  await release(0,{success:false,error:'AY旧读取失败'});
  expect(screen.queryByRole('alert',{name:'订单读取失败'})).toBeNull();expect(screen.getByText(ORDER.username,{exact:true})).toBeTruthy();
 });
 it('old failure cannot end the newer pending loading state',async():Promise<void>=>{
  await mount();await release(0,{success:false,error:'AY旧读取失败'});
  expect(screen.queryByRole('alert',{name:'订单读取失败'})).toBeNull();expect(screen.getByRole('status',{name:'订单加载状态'})).toBeTruthy();
  await release(1,{success:true,orders:[ORDER]});expect(screen.queryByRole('status',{name:'订单加载状态'})).toBeNull();expect(screen.getByText(ORDER.username,{exact:true})).toBeTruthy();
 });
});
