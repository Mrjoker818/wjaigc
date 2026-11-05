// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createMemorySimpleChatEnvelopeStore,envelope,project} from '@/__tests__/fixtures/simple-chat-sync';
import DashboardView from '@/components/dashboard/dashboard-view';

const state=vi.hoisted(()=>({mode:'empty',actor:'A',reads:0,store:null as ReturnType<typeof createMemorySimpleChatEnvelopeStore>|null,gate:null as null|((response:Response)=>void),calls:[] as string[]}));
vi.mock('@/lib/simple-chat-sync-storage',()=>({createIndexedDbSimpleChatEnvelopeStore:()=>({...state.store!,get:async(id:string)=>{state.reads++;if(state.mode==='storage-failure')throw Error('synthetic storage failure');return state.store!.get(id)}})}));
const user=(id='A')=>({id,name:id,productType:'chat',createdAt:1,updatedAt:1});
function mount(id='A'){return render(<DashboardView user={user(id)} onOpenProject={()=>{}} onNewProject={()=>{}}/>)}
beforeEach(async()=>{
 state.mode='empty';state.actor='A';state.reads=0;state.calls=[];state.gate=null;state.store=createMemorySimpleChatEnvelopeStore();
 await state.store.put({...envelope('A'),currentProjects:[{...project('same'),name:'A本地内容'}]});
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k),clear:()=>values.clear()});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);state.calls.push(url);
  if(url==='/api/session') {if(state.mode==='offline')throw Error('offline');return Response.json({success:true,user:{id:state.actor}})}
  if(url.includes('chat_simple_projects')||url.startsWith('/api/simple-chat/actor-bound-sync-v1')){
   if(state.mode==='hold') return await new Promise<Response>(resolve=>{state.gate=resolve});
   if(state.mode==='offline'||state.mode==='network'||state.mode==='storage-failure')throw Error('synthetic offline');
   if(state.mode==='denied')return new Response('{}',{status:403});
   if(state.mode==='service')return new Response('{}',{status:503});
   if(state.mode==='mismatch')return new Response(JSON.stringify({code:'ACTOR_SCOPE_CHANGED'}),{status:409});
   return Response.json({success:true,principalId:state.actor,value:state.mode==='empty'?[]:[{...project('remote'),name:'远端新项目'}],syncRevision:1});
  }
  return Response.json({success:false});
 }));
});
afterEach(()=>{state.gate?.(new Response('{}',{status:503}));cleanup();vi.useRealTimers();vi.unstubAllGlobals()});

it('shows the original empty state after a successful empty response',async()=>{mount();expect(await screen.findByText('暂无对话项目')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull()});
it('403 is a permission error with retry rather than a false empty result',async()=>{state.mode='denied';mount();expect(await screen.findByText('当前账号无法读取对话项目，请检查登录状态后重试。')).toBeTruthy();expect(screen.queryByText('暂无对话项目')).toBeNull();expect(screen.getByRole('button',{name:'重试读取'})).toBeTruthy();expect(state.reads).toBe(0);state.mode='ok';fireEvent.click(screen.getByRole('button',{name:'重试读取'}));expect(await screen.findByText('远端新项目')).toBeTruthy()});
it('network failure displays the existing same-user local fallback and an unsynced notice',async()=>{state.mode='network';mount();expect(await screen.findByText('A本地内容')).toBeTruthy();expect(screen.getByText('同步暂不可用，当前显示本机副本，远端状态未确认。')).toBeTruthy();expect(screen.getByRole('button',{name:'重试读取'})).toBeTruthy()});
it('full offline preserves the old local fallback contract',async()=>{state.mode='offline';mount();expect(await screen.findByText('A本地内容')).toBeTruthy();expect(screen.getByText('同步暂不可用，当前显示本机副本，远端状态未确认。')).toBeTruthy();expect(state.reads).toBe(1)});
it('503 preserves the old local fallback with an explicit notice',async()=>{state.mode='service';mount();expect(await screen.findByText('A本地内容')).toBeTruthy();expect(screen.getByText('同步暂不可用，当前显示本机副本，远端状态未确认。')).toBeTruthy();expect(state.reads).toBe(1)});
it('local storage failure is explicit and retry can recover',async()=>{state.mode='storage-failure';mount();expect(await screen.findByText('本机数据读取失败，请检查浏览器存储后重试。')).toBeTruthy();state.mode='ok';fireEvent.click(screen.getByRole('button',{name:'重试读取'}));expect(await screen.findByText('远端新项目')).toBeTruthy()});
it('bounds a stalled request, allows retry and ignores its late response',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});state.mode='hold';mount();await act(async()=>{await Promise.resolve();await Promise.resolve()});expect(state.gate).not.toBeNull();const late=state.gate!;
 await act(async()=>{await vi.advanceTimersByTimeAsync(4000)});expect(screen.getByText('读取较慢，仍在进行；完成后会自动显示，也可以重试。')).toBeTruthy();state.mode='ok';fireEvent.click(screen.getByRole('button',{name:'重试读取'}));await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()});expect(screen.getByText('远端新项目')).toBeTruthy();
 await act(async()=>{late(Response.json({success:true,principalId:'A',value:[{...project('old'),name:'迟到旧项目'}],syncRevision:1}));await Promise.resolve()});expect(screen.queryByText('迟到旧项目')).toBeNull();
});
it('a late A response cannot replace B after account change',async()=>{
 state.mode='hold';const view=mount('A');await waitFor(()=>expect(state.gate).not.toBeNull());const late=state.gate!;
 state.actor='B';state.mode='ok';view.rerender(<DashboardView user={user('B')} onOpenProject={()=>{}} onNewProject={()=>{}}/>);
 expect(await screen.findByText('远端新项目')).toBeTruthy();
 await act(async()=>{late(Response.json({success:true,principalId:'A',value:[{...project('a'),name:'A迟到内容'}],syncRevision:1}));await Promise.resolve()});
 expect(screen.queryByText('A迟到内容')).toBeNull();expect(screen.getByText('远端新项目')).toBeTruthy();
});
